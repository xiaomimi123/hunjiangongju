import {
  prisma,
  llmComplete,
  validateScript,
  trimToBudget,
  readCharHardCap,
  splitCaptionPhrases,
  setGenerationStatus,
  enqueueGen,
  getCapabilityConfig,
  isMockMode,
  pickAngle,
  parseTemplateParams,
  fitToSegmentCount,
  slotDurationsForSegments,
  speechCapacities,
  charsForSpeechMs,
  charBudgetsFromWeights,
  rebalanceToSlotChars,
  openFlashWindowMs,
} from '@mixcut/db'
import { splitScriptToSegments } from './splitScript'

const MAX_ATTEMPTS = 3

export type BookInput = { title: string; author?: string; points?: string }

export type ScriptFrameworkInput = {
  frameworkText: string
  segCount: number
  maxLines: number
  maxTotalChars: number
}

/**
 * 从生成任务的 variables（Json）判定入口模式：
 * `variables.books` 为非空数组 → 「手填书单」模式，透传书单；否则 → 「选题自选」模式。
 */
// 从拆解框架的 overlayTemplate.books 读出识别到的书目，供生成时自动带上（改进3）。
export function frameworkBooks(overlayTemplate: unknown): BookInput[] {
  const ot = overlayTemplate && typeof overlayTemplate === 'object' ? (overlayTemplate as Record<string, unknown>) : null
  const raw = ot?.books
  if (!Array.isArray(raw)) return []
  return (raw as { title?: unknown; author?: unknown }[])
    .filter((b) => b && typeof b.title === 'string' && b.title.trim())
    .map((b) => {
      const title = (b.title as string).trim()
      return typeof b.author === 'string' && b.author.trim() ? { title, author: (b.author as string).trim() } : { title }
    })
}

export function resolveScriptMode(variables: unknown): { mode: 'books' | 'subject'; books?: BookInput[] } {
  if (variables && typeof variables === 'object' && !Array.isArray(variables)) {
    const raw = (variables as Record<string, unknown>).books
    if (Array.isArray(raw) && raw.length > 0) {
      return { mode: 'books', books: raw as BookInput[] }
    }
  }
  return { mode: 'subject' }
}

function formatBookLine(b: BookInput, i: number): string {
  const parts = [`${i + 1}. 《${b.title}》`]
  if (b.author) parts.push(`作者：${b.author}`)
  if (b.points) parts.push(`要点：${b.points}`)
  return parts.join(' ｜ ')
}

/**
 * 纯函数，无副作用：根据入口模式拼装 LLM prompt。
 * - `books` 模式：逐本列出书名/作者/要点，指示按书单逐句写书评口吻文案。
 * - `subject` 模式：只给选题，指示 LLM 先选书（不输出选书过程/书单），再逐句写文案。
 * 字数/行数上限直接复用框架已推导的 `maxLines`/`maxTotalChars`（deriveCharBudget 产出），不在此重新计算。
 */
// 书单号爆款文案风格准则（对齐优质书单号：口语化、情绪优先、无营销腔）。
// hasOpenTitle=true 时首条必须让步：模板已有「今天分享的是」这类开场标题，
// 此时要求写开场白与原文「不要先介绍书」正面冲突，两条打架会让 LLM 输出不稳定。
/**
 * @param titleFirst 第二段是否要以书名开头。
 *   单本模式的成片结构是：碎裂开场念「今天分享的是…」→ 书封快闪（无旁白）→
 *   正片第一句才报出书名。所以那种情况下「不要先介绍书」这条要让路，
 *   否则两条指令互相打架，模型只能二选一。
 */
function styleRules(hasOpenTitle: boolean, titleFirst = false): string {
  return [
    '文案风格准则（务必遵守）：',
    titleFirst
      ? '- 报出书名之后立刻直击情绪、给一个具体场景或画面，不要泛泛介绍这本书讲什么。'
      : hasOpenTitle
        ? '- 开场白之后的第一句直击情绪、给一个具体场景或画面，不要先介绍书或说"今天推荐"。'
        : '- 开篇第一句直击情绪、给一个具体场景或画面，不要先介绍书或说"今天推荐"。',
    '- 短句、口语化、像跟朋友说话；多用具体细节，少用抽象大词。',
    '- 严禁"你是不是……"式营销开头、"不是……而是……"的对仗论证、机械排比。',
    '- 结尾留余味、给一句能被记住的话；严禁任何 CTA（买它/点购物车/关注/链接）。',
  ].join('\n')
}

/**
 * 提示词要用到的框架约束。
 *
 * slotChars：**逐段**字数配额。原先只给一个总数 + 平均值，而平均是均匀的，
 * 草稿的正片段却是不均的（实测 5.7/8.1/6.1 秒 → 28.7%/40.6%/30.6%）。
 * 段时长由 TTS 时长累加决定、TTS 时长由字数决定，所以只给平均值，
 * 成片节奏就永远回不到草稿（实测出来是 3.6/4.2/9.4 秒）。
 */
export interface ScriptFrameworkArgs {
  frameworkText: string
  segCount: number
  maxLines: number
  maxTotalChars: number
  slotChars?: number[]
}

/**
 * 字数提示：有逐段配额就逐段给，否则回退平均值（老框架零回归）。
 * 逐段配额来自草稿各正片段的实测时长，见 ScriptFrameworkArgs.slotChars。
 */
function charsHint(f: ScriptFrameworkArgs, fallback = ''): string {
  const per = f.slotChars
  if (Array.isArray(per) && per.length === f.segCount && per.length > 0) {
    return `（各段目标字数依次为 ${per.join('、')}，这是按原片各分镜时长定的，务必逐段贴近，不要把字堆在某一段）`
  }
  // fallback 必须是**该处提示词改动前的原文**：仿写等提示词有逐字节回归红线守着，
  // 没有逐段配额时多出一句「平均每段约 X 字」也算破坏契约。
  return fallback
}

export function buildScriptPrompt(args: {
  mode: 'books' | 'subject'
  subject: string
  books?: BookInput[]
  framework: ScriptFrameworkInput
  variablesText?: string
  angle?: string
  openTitleText?: string
}): string {
  const { mode, subject, books, framework, variablesText = '', angle, openTitleText } = args
  const { frameworkText, segCount, maxLines, maxTotalChars } = framework
  const openTitle = (openTitleText ?? '').trim()

  if (mode === 'books') {
    const list = (books ?? []).map(formatBookLine).join('\n')
    const n = books?.length ?? 0
    // 书序号让《书名》头严格跟随内容；开场白行用 0，不归属任何一本书。
    const openLine = openTitle
      ? `每一条文案单独一行，行首必须标出这句讲的是第几本书，格式为「书序号|文案」，书序号取上面书单的编号 1-${n}；第一行必须是开场白，以「${openTitle}」开头，用一句话点出这几本书共同解决的问题，这一行的书序号写 0。`
      : `每一条文案单独一行，行首必须标出这句讲的是第几本书，格式为「书序号|文案」，书序号取上面书单的编号 1-${n}。`
    // books 分支的条目编号随 angle 条目的有无整体顺延，故用数组拼装后统一编号，
    // 避免手写序号出现两个末位序号。
    const bookItems = [
      openLine,
      '按书单顺序为每本书逐句撰写书评文案；语言需贴合书评人口吻，突出该书的核心价值与阅读理由。',
      '除行首的「书序号|」外，只输出文案正文，不要编号、不要额外标题、不要任何解释说明。',
      `总字数不超过 ${maxTotalChars} 字（不含行首书序号）${charsHint(framework)}，总行数不超过 ${maxLines} 行，请依书目数量合理分配每本书的篇幅。`,
      '严禁照搬书籍简介原文，必须围绕给定要点原创改写。',
      ...(angle ? [`本条整体采用「${angle}」的切入角度展开，与其它角度明显区分。`] : []),
    ]
    return [
      '你是一名书单号短视频文案写手。请根据下面的「文案框架」，为以下书单逐句创作书评口吻的文案。',
      '',
      `文案框架：\n${frameworkText}`,
      `书单（共 ${n} 本）：\n${list}`,
      '',
      '要求：',
      ...bookItems.map((s, i) => `${i + 1}. ${s}`),
      '',
      styleRules(Boolean(openTitle)),
    ].join('\n')
  }

  // subject 分支的条目编号随开场白条目的有无整体顺延，故用数组拼装后统一编号，
  // 避免手写序号出现两个「3.」。
  const subjectItems = [
    '请先选书：在心里挑选 2-4 本与选题高度相关、适合书单号推荐的书籍（无需输出选书过程与书单本身），再围绕选定书目逐句撰写书评文案。',
    `分成 ${segCount} 段，每段单独一行，段与段之间用换行分隔。`,
    ...(openTitle ? [`第一段必须是开场白，以「${openTitle}」开头，用一句话点出这条视频要解决的问题。`] : []),
    '只输出文案正文，不要编号、不要标题、不要选书清单、不要任何解释说明。',
    `总字数不超过 ${maxTotalChars} 字${charsHint(framework)}，总行数不超过 ${maxLines} 行。`,
    '严禁照搬原文或框架示例，必须围绕选题原创改写。',
  ]
  return [
    '你是一名书单号短视频文案写手。请根据下面的「文案框架」和「选题」创作一条口播文案。',
    '',
    `文案框架：\n${frameworkText}`,
    `选题：${subject}${variablesText}`,
    '',
    '要求：',
    ...subjectItems.map((s, i) => `${i + 1}. ${s}`),
    '',
    styleRules(Boolean(openTitle)),
  ].join('\n')
}

export type MarkedLine = { bookIdx: number; text: string }

// 半角 | 与全角 ｜ 都接受：LLM 中文输出常给全角。
const BOOK_MARK_RE = /^\s*(\d+)\s*[|｜]\s*(.+)$/

/**
 * 纯函数：解析 LLM 按「书序号|文案」格式输出的行。
 * 全有或全无——任一非空行不匹配格式、或序号不在 0..bookCount，整体返回 null 表示须回退位置均分。
 * 半解析会产出比均分更难预料的错位，故不做部分采用。
 * 序号 0 = 开场白（无书名头）；序号 k = 第 k 本书。
 * 不变式：返回的每条 text 均非空且已 trim——主流程据此保证 trimToBudget 裁剪后
 * 文案数组与序号数组仍逐项配对（trimToBudget 内部会 filter(Boolean)，空串会让两者错位）。
 */
export function parseBookMarkedLines(lines: string[], bookCount: number): MarkedLine[] | null {
  const nonEmpty = lines.map((l) => l.trim()).filter(Boolean)
  if (nonEmpty.length === 0) return null
  const out: MarkedLine[] = []
  for (const line of nonEmpty) {
    const m = BOOK_MARK_RE.exec(line)
    if (!m) return null
    const bookIdx = Number(m[1])
    if (!Number.isInteger(bookIdx) || bookIdx < 0 || bookIdx > bookCount) return null
    const text = m[2].trim()
    if (!text) return null
    out.push({ bookIdx, text })
  }
  return out
}

// 剥离侧专用：识别「只有编号+分隔符、后面无文案」的裸标记行（如「3|」）。
// 不能与 BOOK_MARK_RE 共用——BOOK_MARK_RE 的 (.+) 故意要求分隔符后至少一个字符，
// 这是 parseBookMarkedLines「一行连文案都没有 → 判定整体不可信、返回 null 交由上层整体
// 回退位置均分」这条语义的基础；若把 (.+) 放宽成 (.*) 让两处共用，parseBookMarkedLines
// 会把裸标记行当成合法标记采纳，产出一条 text 为空串的 MarkedLine，违反本文件另一处
// 「返回的每条 text 均非空」的不变式（trimToBudget 裁剪后文案数组与序号数组会错位）。
// 两条正则各司其职：BOOK_MARK_RE 判「标记是否完整合法」，BOOK_MARK_BARE_RE 只在剥离侧
// 补一种「合法编号+分隔符，但空文案」的兜底识别，不影响 parseBookMarkedLines 的判定。
const BOOK_MARK_BARE_RE = /^\s*\d+\s*[|｜]\s*$/

/**
 * 纯函数：剥离单行开头可能存在的「书序号|」标记，与 parseBookMarkedLines 复用同一条
 * BOOK_MARK_RE（用于识别"编号+分隔符+文案"的完整标记），保证对同一行的判定结果一致，
 * 不会出现两套正则各判各的分歧。
 * - 命中 BOOK_MARK_RE（有文案）→ 返回捕获组里的文案（trim 后）。
 * - 命中 BOOK_MARK_BARE_RE（裸标记，如「3|」，编号+分隔符后无文案）→ 返回空串，交由
 *   调用方（validateScript/trimToBudget 的 filter(Boolean)）统一过滤掉这一行。
 * - 都未命中（含普通无标记行）→ 原样返回（trim 后）。
 * 不做序号范围校验——parseBookMarkedLines 的「全有或全无」语义决定整体是否采信标记来定
 * 书名头，本函数只负责在「我们要求过标记」的路径上兜底清除标记文本，不判定标记是否有效。
 * 用于 parseBookMarkedLines 因个别行漏打标记（或裸标记）而整体返回 null 时的回退：
 * 书名头归属回退到位置均分没错，但已经打了标记的那些行（含裸标记碎片）不能带着
 * 「1|」「3|」这类前缀/碎片原样落库——那是 LLM 未处理过的标记语法，会被
 * splitCaptionPhrases 当正常字幕切、被 TTS 原样念出来。
 */
export function stripBookMark(line: string): string {
  const trimmed = line.trim()
  const m = BOOK_MARK_RE.exec(trimmed)
  if (m) return m[2].trim()
  if (BOOK_MARK_BARE_RE.test(trimmed)) return ''
  return trimmed
}

/**
 * 纯函数：把 `segCount` 个按序生成的分段，均匀、连续地分配到 `bookCount` 本书下标（0-based）。
 * 用于 books 模式——LLM 按书单顺序逐句撰写，本函数只按位置做整除分配，不解析文案内容。
 * - `bookCount <= 0`（subject 模式或空书单）：全部返回 -1，表示无归属。
 * - 段数少于书数：靠后的书分不到段（属预期——书单本就比段落多，无法每本都覆盖）。
 */
export function allocateBookIndexes(segCount: number, bookCount: number): number[] {
  if (bookCount <= 0) return new Array(segCount).fill(-1)
  const out: number[] = []
  for (let i = 0; i < segCount; i++) {
    out.push(Math.min(bookCount - 1, Math.floor((i * bookCount) / segCount)))
  }
  return out
}

export type AssignedSegment = { scriptText: string; bookTitle?: string; bookAuthor?: string }

/**
 * 纯函数：结合 `allocateBookIndexes` 把书目的 title/author 落到每段文案上。
 * books 为空数组（subject 模式）时原样透传，不带 bookTitle/bookAuthor。
 */
// 仅 auto 模式才按书单位置分配《书名》头；manual/imitate 是用户自控文案，不该被框架书目
// 位置分配（否则单主题手动稿会出现轮换错乱的书名头）。per-gen bookTitle 仍可在其上显式覆盖。
export function booksForAssign(
  scriptMode: 'auto' | 'manual' | 'imitate',
  books: BookInput[] | undefined,
): BookInput[] {
  return scriptMode === 'auto' ? (books ?? []) : []
}

/**
 * 纯函数：结合书序号把书目的 title/author 落到每段文案上。
 * `bookIdxs` 给定（1-based，0=无书名头）且长度与 lines 相同时，按它分配——这是让《书名》头
 * 严格跟随文案内容的路径；未给定或长度不符时回退 `allocateBookIndexes` 的位置均分。
 * books 为空数组（subject 模式）时原样透传，不带 bookTitle/bookAuthor。
 */
export function assignBooksToSegments(
  lines: string[],
  books: BookInput[],
  bookIdxs?: number[],
): AssignedSegment[] {
  if (books.length === 0) return lines.map((scriptText) => ({ scriptText }))
  const idxs = bookIdxs && bookIdxs.length === lines.length
    ? bookIdxs.map((n) => (n >= 1 && n <= books.length ? n - 1 : -1))
    : allocateBookIndexes(lines.length, books.length)
  return lines.map((scriptText, i) => {
    const book = books[idxs[i]]
    if (!book) return { scriptText }
    return book.author ? { scriptText, bookTitle: book.title, bookAuthor: book.author } : { scriptText, bookTitle: book.title }
  })
}

/**
 * 纯函数：拼装单句中译英字幕的翻译 prompt。
 */
export function buildTranslatePrompt(zh: string): string {
  return [
    '请将下面这句中文短视频口播文案翻译成自然、简洁的英文字幕。',
    `中文原句：${zh}`,
    '只输出英文翻译本身，不要输出中文、拼音、引号或任何解释说明。',
  ].join('\n')
}

/**
 * 纯函数：根据参考文案拼装仿写提示词。
 * 指示 LLM 仿照参考文案的语气、句式、情感浓度与第二人称口吻，就同一主题原创改写一条新文案。
 * 复用 styleRules(hasOpenTitle)（包括禁 CTA 条款）；openTitleText 非空时与 buildScriptPrompt
 * 行为对齐——要求首段为呼应该标题的开场白，同时风格准则首条让步为「开场白之后的第一句」，
 * 避免与「不要先介绍书」正面冲突（flash 模板选仿写模式时同样会漏开场白，需一并修）。
 */
export function buildImitatePrompt(args: {
  reference: string
  subject: string
  framework: ScriptFrameworkArgs
  openTitleText?: string
}): string {
  const { reference, subject, framework, openTitleText } = args
  const { frameworkText, segCount, maxLines, maxTotalChars } = framework
  const openTitle = (openTitleText ?? '').trim()
  // 条目编号随开场白条目的有无整体顺延，故用数组拼装后统一编号，避免手写序号出现两个末位序号。
  const items = [
    `分成约 ${segCount} 段，每句单独一行；第二人称口吻，围绕一个核心主题贯穿，不逐本介绍、不讲故事情节。`,
    ...(openTitle ? [`第一段必须是开场白，以「${openTitle}」开头，用一句话点出这条视频要解决的问题。`] : []),
    '只输出文案正文，不要编号、不要标题、不要任何解释说明。',
    '必须原创改写，严禁照抄参考文案或框架示例。',
    `总字数不超过 ${maxTotalChars} 字${charsHint(framework)}，总行数不超过 ${maxLines} 行。`,
  ]
  return [
    '你是一名书单号短视频文案写手。请【仿照】下面这段【参考文案】的语气、句式、情感浓度与第二人称口吻，就同一主题原创改写一条新文案。',
    '',
    `参考文案（模仿其风格与节奏，不要照抄内容）：\n${reference}`,
    `主题：${subject}`,
    `文案框架：\n${frameworkText}`,
    '',
    '要求：',
    ...items.map((s, i) => `${i + 1}. ${s}`),
    '',
    styleRules(Boolean(openTitle)),
  ].join('\n')
}

/**
 * 纯函数：单本书成片的提示词。与 buildScriptPrompt 的 books 模式的根本区别是——
 * 全篇只讲一本书，因此不需要「书序号|文案」标记（只有一本，标记没有意义，多一条格式
 * 指令只会增加模型出错面）。调性由 frameworkText 决定，不在此写死风格词。
 */
export interface ScriptPolicy {
  /** 开场白只念开场标题本身，不加任何其它话（见 templateParams.script 的注释） */
  openingTitleOnly?: boolean
  titleInOpening: boolean
  titleSegment: number
  extraRules: string
}

export function buildSingleBookPrompt(args: {
  book: BookInput
  framework: ScriptFrameworkInput
  angle?: string
  openTitleText?: string
  /** 文案口径（templateParams.script）。缺省 = 现行行为：书名留到第二段 */
  policy?: ScriptPolicy
}): string {
  const { book, framework, angle, openTitleText, policy } = args
  const { frameworkText, segCount, maxLines, maxTotalChars } = framework
  const openTitle = (openTitleText ?? '').trim()

  const bookLine = [`《${book.title}》`]
  if (book.author) bookLine.push(`作者：${book.author}`)
  if (book.points) bookLine.push(`要点：${book.points}`)

  // 文案口径可由框架配置（剪辑工作台的「文案口径」分区）。
  // 缺省 = 现行行为：开场白不含书名、书名在第二段开头报出（对齐快闪揭晓的节奏）。
  const titleInOpening = policy?.titleInOpening ?? false
  // 直接调用（测试/旧代码）缺省保持旧行为；生产走 parseTemplateParams，默认 true
  const openingTitleOnly = policy?.openingTitleOnly ?? false
  const titleSeg = Math.min(policy?.titleSegment ?? 2, segCount)
  const extraRules = (policy?.extraRules ?? '').trim()

  const items = [
    // 成片结构：碎裂开场念开场白 → 书封快闪（无旁白）→ 正片才报书名。
    // 书名塞进开场白的话，画面还在碎裂时书名就念出来了，与快闪揭晓的节奏对不上
    // ——但项目方要不同节奏时可以在框架里改（titleInOpening / titleSegment）。
    ...(openTitle
      ? titleInOpening
        ? [`第一段是开场白：以「${openTitle}《${book.title}》」开头，一句话点出这条视频要解决的问题。`]
        : openingTitleOnly
          ? [
              // 原工程的开场人声只有标题这几个字——快闪的静默就是节奏的一部分。
              `第一段只有「${openTitle}」这几个字，**原样输出，不得增删任何内容**。`,
              `第 ${titleSeg} 段必须以「《${book.title}》」这个书名开头，报出书名后再展开。`,
            ]
          : [
              `第一段是开场白：以「${openTitle}」开头，用一句话点出这条视频要解决的问题，**整段不得出现书名**。`,
              `第 ${titleSeg} 段必须以「《${book.title}》」这个书名开头，报出书名后再展开。`,
            ]
      : []),
    `分成 ${segCount} 段，每段单独一行，段与段之间用换行分隔。`,
    // 核心约束：模型写书评时天然爱旁征博引，不明说必犯。
    `全篇只讲《${book.title}》这一本书，不得提及、引用或对比任何其他书籍，也不得出现其他书名。`,
    '只输出文案正文，不要编号、不要标题、不要任何解释说明。',
    // 字数上限来自「正片时长 × 实测语速」，是硬约束：超了配音就塞不进画面。
    // 平均到每段的字数一并给出——只给总数时模型容易把字都堆在最后一段。
    `总字数**严格不超过 ${maxTotalChars} 字**${charsHint(framework, `（平均每段约 ${Math.floor(maxTotalChars / Math.max(1, segCount))} 字）`)}，总行数不超过 ${maxLines} 行。宁可少写，不可超。`,
    '严禁照搬书籍简介原文，必须围绕给定要点原创改写。',
    // 不禁止的话模型会去复述原著：人物、桥段、结局一路讲下来，既像剧透又填满字数。
    // 书单号要的是「这本书打中了我哪里」，不是「这本书讲了什么故事」。
    '不要复述书里的情节、人物姓名或结局，不做剧情简介；写这本书带给读者的感受与共鸣，用普通人日常里的具体场景来承载。',
    ...(angle ? [`本条整体采用「${angle}」的切入角度展开，与其它角度明显区分。`] : []),
    // 运营写的附加规则原样追加。放在编号清单里而不是拼在结尾——
    // 编号项的遵守率明显高于尾部散文（模型对"要求列表"的注意力更稳定）。
    ...(extraRules ? extraRules.split('\n').map((l) => l.trim()).filter(Boolean) : []),
  ]

  return [
    '你是一名书单号短视频文案写手。请根据下面的「文案框架」，为下面这一本书创作一条口播文案。',
    '',
    `文案框架：\n${frameworkText}`,
    `书籍：${bookLine.join(' ｜ ')}`,
    '',
    '要求：',
    ...items.map((s, i) => `${i + 1}. ${s}`),
    '',
    // 单本模式：书名在指定段开头报出时，styleRules 的「不要先介绍书」要让路
    styleRules(Boolean(openTitle), Boolean(openTitle) && !titleInOpening),
  ].join('\n')
}

export function readScriptMode(variables: unknown): 'auto' | 'manual' | 'imitate' {
  const m = variables && typeof variables === 'object' && !Array.isArray(variables)
    ? (variables as Record<string, unknown>).scriptMode : undefined
  return m === 'manual' || m === 'imitate' ? m : 'auto'
}
export function readCustomScript(variables: unknown): string {
  const v = variables && typeof variables === 'object' && !Array.isArray(variables)
    ? (variables as Record<string, unknown>).customScript : undefined
  return typeof v === 'string' ? v : ''
}
export function readBookTitle(variables: unknown): string | undefined {
  const v = variables && typeof variables === 'object' && !Array.isArray(variables)
    ? (variables as Record<string, unknown>).bookTitle : undefined
  return typeof v === 'string' && v.trim() ? v.trim() : undefined
}

/**
 * 从 variables 读单本模式的主题书。存在即表示本次生成走「全篇只讲一本」的路径。
 * 由 select-books 写入；运营手填书单、manual/imitate、老任务重跑都不会有该字段。
 */
/** 读框架配置的图片槽位数；未配置返回 0（表示不强制段数） */
export function readImageSlotCount(overlayTemplate: unknown): number {
  const ot = overlayTemplate && typeof overlayTemplate === 'object' && !Array.isArray(overlayTemplate)
    ? (overlayTemplate as Record<string, unknown>) : null
  const slots = ot?.__imageSlots
  if (!slots || typeof slots !== 'object' || Array.isArray(slots)) return 0
  const c = (slots as Record<string, unknown>).count
  return typeof c === 'number' && Number.isInteger(c) && c > 0 ? c : 0
}

export function readThemeBook(variables: unknown): BookInput | undefined {
  const v = variables && typeof variables === 'object' && !Array.isArray(variables)
    ? (variables as Record<string, unknown>).themeBook : undefined
  if (!v || typeof v !== 'object' || Array.isArray(v)) return undefined
  const o = v as { title?: unknown; author?: unknown; points?: unknown }
  if (typeof o.title !== 'string' || !o.title.trim()) return undefined
  return {
    title: o.title.trim(),
    ...(typeof o.author === 'string' && o.author.trim() ? { author: o.author.trim() } : {}),
    ...(typeof o.points === 'string' && o.points.trim() ? { points: o.points.trim() } : {}),
  }
}

// mock 模式固定定长占位英文字幕；translateLine 的 mock 分支自带该 fixture，
// 绝不经由 llmComplete 的通用 mock（那是无关的固定中文文案，不适合充当"翻译结果"）。
const MOCK_SUBTITLE_EN = 'This is a mock English subtitle placeholder.'

/**
 * LLM 中译英单句字幕。mock 模式（AI_MOCK=1 或 llm 能力未启用）下直接返回固定占位英文，
 * 不发起任何网络请求；真实模式复用通用 llmComplete 发起翻译请求。
 */
export async function translateLine(zh: string): Promise<string> {
  const cfg = await getCapabilityConfig('llm')
  if (isMockMode(cfg)) return MOCK_SUBTITLE_EN
  const out = await llmComplete({ prompt: buildTranslatePrompt(zh) })
  return out.trim()
}

export async function generateScript(genTaskId: string): Promise<void> {
  const task = await prisma.generationTask.findUniqueOrThrow({
    where: { id: genTaskId },
    include: { framework: true },
  })
  const fw = task.framework

  const segCount = fw.suggestedSegmentCount ?? 8
  const maxLines = fw.maxLines ?? 21
  const maxTotalChars = fw.maxTotalChars ?? 220
  // 裁剪只在超过**硬上限**时才做。软预算(maxTotalChars)是告诉 AI 的目标,
  // 写超一点点不该被裁 —— 裁剪从尾部整行丢弃,丢掉的正是收尾句,
  // 听感上就是「话没说完就结束了」(线上实测: 105 字被裁到 89,收尾句没了)。
  const hardCap = readCharHardCap(fw.overlayTemplate, maxTotalChars) ?? maxTotalChars
  // 仅 flash 模板会把第 0 段整段吃进开场快闪且不出字幕（indexHtml 正片字幕取 segs.slice(1)），
  // 只有这种模板需要一句与开场标题呼应的旁白；classic 模板第 0 段照常出字幕，不加开场白。
  const tp = parseTemplateParams((fw.overlayTemplate as { __templateParams?: unknown } | null)?.__templateParams)
  const openTitleText = tp.mode === 'flash' ? tp.open.titleText : undefined

  // 逐段字数配额：按草稿各分镜的实测时长分。只给总数与平均值时，
  // LLM 会把字堆在某一段（实测成片正片是 3.6/4.2/9.4 秒，草稿是 5.7/8.1/6.1）。
  //
  // ★ 槽位表必须与 generateTts 用的是同一份（slotDurationsForSegments）。
  // 此前这里传 segCount、配音侧传 segCount-1，同一个函数被喂了不同的 n，
  // 配额表整体错位一格：文案侧以为有 4 个正片槽位，实际只有 3 个，
  // 第 0 段其实是开场白（占开场+快闪窗口，不在正片槽位里）。
  const timelineMs = slotDurationsForSegments(openFlashWindowMs(tp), tp.body.slotDurationsMs, segCount)
  // 分字数要按「能说话的时长」而不是「占位时长」：快闪期间与书名前的留白
  // 是节奏的一部分，不是可以拿来塞字的空间（见 speechCapacities）。
  const speechCap = speechCapacities(timelineMs, tp.open.durationMs, tp.pace?.bookTitleLeadMs)
  // ★ 总量再按**实测语速**兜一道。
  // 框架里存的 maxTotalChars 是导入时按 CHARS_PER_SEC=6 推的，而那个常数是换成
  // 豆包声音复刻 2.0 **之前**测的；实测这条克隆音色只有 5.56 字/秒，按 6 推的预算
  // 系统性偏松约 8%。改导入期的常数对**存量框架**无效（值已经落库），所以在这里
  // 按语音容量重算一次上界，取两者较小的。
  const capTotal = charsForSpeechMs(speechCap.reduce((a, b) => a + b, 0), tp.pace?.speechCharsPerSec)
  const budgetChars = capTotal > 0 ? Math.min(maxTotalChars, capTotal) : maxTotalChars
  const slotChars = speechCap.length ? charBudgetsFromWeights(speechCap, budgetChars) : undefined
  if (slotChars) {
    console.log(`[gen] generate-script ${genTaskId}: 字数预算 ${maxTotalChars}→${budgetChars}（按语音容量 ${speechCap.join('/')}ms @ 实测语速），逐段 ${slotChars.join('/')}`)
  }

  const resolved = resolveScriptMode(task.variables)
  const mode = resolved.mode
  const books = resolved.books

  const variablesText =
    task.variables && Object.keys(task.variables as object).length > 0
      ? `\n可用变量（JSON）：${JSON.stringify(task.variables)}`
      : ''

  const scriptMode = readScriptMode(task.variables)
  const perGenBookTitle = readBookTitle(task.variables)
  // 单本模式：仅 auto 文案模式生效。manual/imitate 是用户自控文案，themeBook 不得劫持它们。
  const themeBook = scriptMode === 'auto' ? readThemeBook(task.variables) : undefined

  let clean: string[] | null = null
  let markedIdxs: number[] | null = null
  if (scriptMode === 'manual') {
    // 手动：直接切分用户文案，跳过 LLM / validate / 重试
    clean = splitScriptToSegments(readCustomScript(task.variables))
    if (clean.length === 0) {
      await setGenerationStatus(genTaskId, 'FAILED')
      throw new Error('自定义文案为空或无法切分')
    }
    // 安全上限：只有超过硬上限（30 秒成片反推）才裁剪
    clean = trimToBudget(clean, maxLines, hardCap)
  } else {
    // imitate: 用参考仿写；auto: 现状。二者复用现有 validate/重试/兜底循环。
    const angle = pickAngle(genTaskId)
    const basePrompt = scriptMode === 'imitate'
      ? buildImitatePrompt({ reference: readCustomScript(task.variables), subject: task.subject, framework: { frameworkText: fw.frameworkText, segCount, maxLines, maxTotalChars: budgetChars, ...(slotChars ? { slotChars } : {}) }, openTitleText })
      : themeBook
        ? buildSingleBookPrompt({ book: themeBook, framework: { frameworkText: fw.frameworkText, segCount, maxLines, maxTotalChars: budgetChars, ...(slotChars ? { slotChars } : {}) }, angle, openTitleText, ...(tp.script ? { policy: tp.script } : {}) })
        : buildScriptPrompt({ mode, subject: task.subject, books, framework: { frameworkText: fw.frameworkText, segCount, maxLines, maxTotalChars: budgetChars, ...(slotChars ? { slotChars } : {}) }, variablesText, angle, openTitleText })

    let prompt = basePrompt
    let lastErrors: string[] = []
    let lastClean: string[] = []
    let lastIdxs: number[] | null = null
    const bookCount = mode === 'books' && !themeBook ? (books?.length ?? 0) : 0
    // 只有这条路径向 LLM 要求过「书序号|文案」格式（见 buildScriptPrompt 的 openLine/bookItems），
    // 所以也只有这条路径需要在 parseBookMarkedLines 判定失败时兜底剥离标记；
    // subject/manual/imitate 从没要求过标记，贸然剥会误伤本就以「数字|」开头的正常文案。
    const wantsBookMark = bookCount > 0 && scriptMode === 'auto'

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const raw = await llmComplete({ prompt, maxTokens: 1200, temperature: 0.9 })
      const rawLines = raw.split('\n')
      // 标记必须在预算校验之前剥离：validateScript/trimToBudget 按字符数算预算，
      // 带着「1|」前缀会让每行凭空多 2 个字符，挤压真实文案预算并令重试循环误判超限。
      const marked = wantsBookMark ? parseBookMarkedLines(rawLines, bookCount) : null
      // parseBookMarkedLines 是「全有或全无」：只要某一行漏打标记就整体判失败，书名头归属
      // 回退位置均分没错，但已经打了标记的其它行不能带着裸「1|」前缀直接进正文——那会被
      // splitCaptionPhrases 当正常字幕切、被 TTS 原样念出来。故 wantsBookMark 为真时，无论
      // parseBookMarkedLines 整体成功与否，都要逐行剥掉可能存在的标记（stripBookMark 复用
      // 同一 BOOK_MARK_RE，不会与 parseBookMarkedLines 的判定产生分歧）。
      const lines = marked ? marked.map((m) => m.text) : wantsBookMark ? rawLines.map(stripBookMark) : rawLines
      const result = validateScript(lines, maxLines, budgetChars)
      lastClean = result.clean
      lastIdxs = marked ? marked.map((m) => m.bookIdx) : null

      if (result.errors.length === 0) {
        clean = result.clean
        markedIdxs = lastIdxs
        break
      }

      lastErrors = result.errors
      // 追加压缩指令后重试
      prompt = `${basePrompt}\n\n上一次生成过长（${result.errors.join('；')}），请压缩到 ${maxLines} 行 / ${budgetChars} 字以内重写。`
    }

    if (!clean) {
      // 兜底：多次重试仍略超预算（真实 books 模式书评常见）→ 整行裁剪到预算内，不硬失败。
      if (lastClean.length === 0) {
        await setGenerationStatus(genTaskId, 'FAILED')
        throw new Error(`文案生成为空（已重试 ${MAX_ATTEMPTS} 次）：${lastErrors.join('；')}`)
      }
      clean = trimToBudget(lastClean, maxLines, hardCap)
      // trimToBudget 只从尾部整行丢弃且保持顺序，故按裁剪后长度截取序号即可保持配对；
      // 这依赖 parseBookMarkedLines 已保证每条 text 非空（否则 trimToBudget 的 filter(Boolean) 会错位）。
      markedIdxs = lastIdxs ? lastIdxs.slice(0, clean.length) : null
      if (clean.length < lastClean.length) {
        console.warn(`[gen] generate-script ${genTaskId}: 超**硬上限** ${hardCap} 字，裁剪 ${lastClean.length}→${clean.length} 行 (${lastErrors.join('；')})`)
      } else {
        console.log(`[gen] generate-script ${genTaskId}: 超软预算但在硬上限 ${hardCap} 字内，原样采用 (${lastErrors.join('；')})`)
      }
    }

    if (wantsBookMark && !markedIdxs) {
      console.warn(`[gen] generate-script ${genTaskId}: 未能解析书序号标记，《书名》头回退位置均分`)
    }
  }

  // 段数强约束：图片槽位数由草稿锁定时，文案必须恰好 N 段，否则「第 N 张图用这个提示词」
  // 无从谈起（同一位置在不同片子里对应不同内容）。只在框架配了 __imageSlots 时强制，
  // 老框架维持现状、零回归。规整是确定性的，不靠让 LLM 重写——段数不对是结构问题，
  // 重写不保证收敛且每次都要一次 LLM 调用。
  const slotCount = readImageSlotCount(fw.overlayTemplate)
  let lines: string[] = clean
  if (slotCount > 0 && lines.length !== slotCount) {
    const before = lines.length
    lines = fitToSegmentCount(lines, slotCount)
    console.warn(`[gen] generate-script ${genTaskId}: 文案 ${before} 段 → 规整为 ${lines.length} 段（图片槽位数 ${slotCount}）`)
  }

  // ★ 逐段字数配额是给 LLM 的**建议**，不是约束；fitToSegmentCount 也只保证段数不保证分量。
  // 线上实测：117 字的文案里最后一段被塞了约一半，配音 13464ms 对着草稿 6067ms 的槽位（+122%），
  // 成片 24.6→31.3 秒。这里按槽位比例做一次确定性重排兜底（明显失衡才介入）。
  //
  // 开场白不参与：它与第二段的分工是硬约定（开场白不得含书名、书名留到第二段开头），
  // 句子跨过这条边界搬运会直接破坏它。
  if (slotChars && openTitleText && lines.length === slotChars.length && lines.length >= 3) {
    const body = rebalanceToSlotChars(lines.slice(1), slotChars.slice(1))
    if (body.some((t, i) => t !== lines[i + 1])) {
      const cnt = (arr: string[]) => arr.map((t) => Array.from(t).length).join('/')
      console.warn(`[gen] generate-script ${genTaskId}: 各段字数偏离草稿槽位，按比例重排 ${cnt(lines.slice(1))} → ${cnt(body)}（目标 ${slotChars.slice(1).join('/')}）`)
      lines = [lines[0], ...body]
    }
  }

  // ★ 开场段强制替换为标题原文（确定性兜底，不信任 AI 遵守）。
  //
  // 「第一段只有这几个字」对 AI 只是建议：配额是建议、重排刻意跳过开场白、
  // 变速上限 1.25× 也兜不住一句长开场白。开场一超长就吃进快闪窗口，
  // 「今天分享的是……（静默）……书名」的节奏直接没了——这是线上实录的事故，
  // 不是假设。manual 模式不动（用户自己写的文案自己负责）。
  if (
    openTitleText && scriptMode !== 'manual' &&
    (tp.script?.openingTitleOnly ?? true) && lines.length >= 2 &&
    lines[0] !== openTitleText
  ) {
    console.warn(`[gen] generate-script ${genTaskId}: 开场段替换为标题原文（AI 写了 ${Array.from(lines[0]).length} 字：「${lines[0].slice(0, 20)}…」）`)
    lines = [openTitleText, ...lines.slice(1)]
  }

  // ★ 书名段强制以《书名》开头（确定性兜底，与开场段替换同一个教训）。
  //
  // 提示词已要求「第 N 段必须以《书名》开头」，但 AI 会违反——线上实录：
  // AI 把书名塞进开场白（被上面的替换丢掉），书名段却没带书名，结果整条片子
  // 没人念书名，TTS 的「书名独立合成」也无从触发。
  // 补「《书名》，」前缀：带逗号是为了切句时书名独立成拍（快闪卡式的字幕），
  // TTS 那边按前缀剥离单独合成。行内已有的书名提法不动（删了会破坏句子）。
  if (themeBook && openTitleText && !(tp.script?.titleInOpening ?? false)) {
    const idx = Math.min(Math.max(1, (tp.script?.titleSegment ?? 2) - 1), lines.length - 1)
    const tag = `《${themeBook.title}》`
    if (!lines[idx].startsWith(tag)) {
      console.warn(`[gen] generate-script ${genTaskId}: 第 ${idx + 1} 段未以书名开头，补「${tag}」前缀（原开头「${lines[idx].slice(0, 12)}…」）`)
      lines = lines.map((l, j) => (j === idx ? `${tag}，${l}` : l))
    }
  }

  // 单本模式：所有正文段统一挂主题书，不走位置均分、也不走书序号标记。
  const assigned = themeBook
    ? lines.map((scriptText) => ({
        scriptText,
        bookTitle: themeBook.title,
        ...(themeBook.author ? { bookAuthor: themeBook.author } : {}),
      }))
    : assignBooksToSegments(lines, booksForAssign(scriptMode, books), markedIdxs ?? undefined)
  const assignedFinal = perGenBookTitle
    ? assigned.map((a) => ({ ...a, bookTitle: perGenBookTitle }))
    : assigned

  // 每段拆成「字幕短句节拍」并逐拍中译英：图片停住、字幕短句快速跳（对齐优质书单号节奏）。
  const segments: {
    generationTaskId: string
    seqNo: number
    scriptText: string
    bookTitle?: string
    bookAuthor?: string
    subtitleEn: string
    captionBeats: { zh: string; en: string }[]
  }[] = []
  // 双语关掉时不翻译：translateLine 是**逐拍一次 LLM 调用**，
  // 而英文只有在 text.bilingual 开启时才会被渲染层消费（见 ass.ts）。
  // 关掉双语还翻译就是纯浪费。
  const wantEn = tp.text?.bilingual === true
  for (let i = 0; i < assignedFinal.length; i++) {
    const { scriptText, bookTitle, bookAuthor } = assignedFinal[i]
    const phrases = splitCaptionPhrases(scriptText, { max: tp.script?.captionMaxChars ?? 12 })
    const beats: { zh: string; en: string }[] = []
    for (const zh of phrases) beats.push({ zh, en: wantEn ? await translateLine(zh) : '' })
    segments.push({
      generationTaskId: genTaskId,
      seqNo: i + 1,
      scriptText,
      ...(bookTitle ? { bookTitle } : {}),
      ...(bookAuthor ? { bookAuthor } : {}),
      subtitleEn: wantEn ? beats.map((b) => b.en).join(' ') : '', // 整段英文=各拍拼接，供回退单条字幕用；关闭双语时收紧为空
      captionBeats: beats,
    })
  }

  await prisma.$transaction([
    // 幂等：先清旧段再写新段
    prisma.generatedSegment.deleteMany({ where: { generationTaskId: genTaskId } }),
    prisma.generatedSegment.createMany({ data: segments }),
  ])

  await setGenerationStatus(genTaskId, 'IMAGE_GENERATING')
  await enqueueGen('generate-image', { genTaskId })
}
