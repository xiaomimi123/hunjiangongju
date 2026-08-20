// select-books：学员填一个书名/主题 → AI 配齐真实存在的完整书单，写回 task.variables.books
// （形状与运营手填书单完全一致），随后接力 generate-script。
//
// 三条硬约束（详见 docs/superpowers/specs/2026-08-18-ai-booklist-selection-design.md）：
// 1. 运营已手填书单（variables.books 非空）→ 原样跳过，直接入队，零回归。
// 2. 本步骤绝不能让生成任务失败：每个外部调用（联网 LLM）都单独 try/catch，任一环节
//    失败都降级而不是抛出；全部失败时兜底为「只用学员自己那本」。
// 3. 学员输入那本书（= 主题书）永远出现且排**末位**——不是"大概率排末位"，是结构上保证：
//    候选池在传给 pickSubset 之前先把学员那本剔除掉（避免被随机洗牌吞掉或排到别处），
//    随机只从"陪衬书名额"里选，选完再把学员那本挂到最后面。
//    排末位是产品要求：快闪严格按 variables.books 顺序出卡，末位即「最后一张定格在主题书」。
//    改这里的顺序前先读 docs/superpowers/specs/2026-08-18-single-book-mode-design.md，
//    不要因为别处还留着"排第一"的旧描述就把它改回去。
// 4.（fix round 1）scriptMode 为 manual/imitate 的任务：subject 此时是从学员粘贴的文案里
//    截出来的片段（见 web/app/api/generate/route.ts 的 finalSubject 兜底逻辑），不是书名/主题，
//    走 AI 选书只会白烧联网检索、且一旦模型误判 YES 就会把文案碎片当真书写进 BookLibrary，
//    污染书库的长期准确性（downstream 的 booksForAssign 本就只在 scriptMode==='auto' 时采用
//    books，manual/imitate 走这一步纯属浪费）。同「规则1」一样原样跳过、直接入队。
import {
  prisma,
  llmComplete,
  getCapabilityConfig,
  isMockMode,
  enqueueGen,
  findBookByTitle,
  findBooksByTheme,
  upsertBook,
  pickSubset,
  parseBookList,
  dedupeBooks,
  resolveBookCount,
  isSameBook,
  type PickedBook,
} from '@mixcut/db'
import { readScriptMode } from './generateScript'

type BookOut = PickedBook

function normalizeTitleLocal(title: string): string {
  return String(title ?? '').replace(/[《》]/g, '').trim()
}

// 用 isSameBook（副标题前缀感知）而非精确字符串比较：三级兜底允许学员那本从候选池"借"作者，
// 借用后学员书用的是原始短标题、候选里保留的是全名版标题，精确匹配会漏判导致同一本书重复出现。
function excludeBook(pool: PickedBook[], book: { title: string; author: string }): PickedBook[] {
  return pool.filter((b) => !isSameBook(b, book))
}

/** variables.books 已存在且非空 → 运营手填模式，本步骤不得介入 */
export function hasManualBooks(variables: unknown): boolean {
  if (!variables || typeof variables !== 'object' || Array.isArray(variables)) return false
  const books = (variables as Record<string, unknown>).books
  return Array.isArray(books) && books.length > 0
}

/** 学员输入是否真实存在的联网查证 prompt：命中返回「作者|主题词」，否则只回 NO */
export function buildVerifySubjectPrompt(subject: string): string {
  return [
    `请判断《${subject}》是否是一本真实存在的书。`,
    '如果是，请严格按「作者|主题词」的格式回复：作者姓名（多位作者用、分隔）在前，跟一个竖线 |，',
    '之后是概括该书主题的词语（2-6 字，如"自我成长""职场""亲密关系"），不要输出任何其它文字；',
    '如果不是真实存在的书或你无法确认，请只回复 NO。',
  ].join('')
}

/** 解析查证响应：NO / 空 / 明显是解释性长文本（非纯作者名）一律视为查证不通过 */
export function parseVerifiedAuthor(raw: string): string | null {
  if (typeof raw !== 'string') return null
  const trimmed = raw.trim()
  if (!trimmed) return null
  if (/^no$/i.test(trimmed)) return null
  const author = trimmed.replace(/^作者[:：]\s*/, '').trim()
  if (!author) return null
  // 真实作者名不含换行/中英文标点、且不会太长；命中任一特征视为"解释性文字"而非纯作者名，剔除。
  if (author.length > 20 || /[\n，。；：、！？,.;:!?]/.test(author)) return null
  return author
}

// parseVerifiedBook 用于剥离查证响应里包裹作者/主题词的书名号、引号：真实作者名/主题词不会
// 天然带这些符号，模型偶尔会加上，剥掉即可，不视为异常。
const WRAP_CHARS = new Set(['《', '》', '「', '」', '『', '』', '"', "'", '“', '”', '‘', '’'])

function stripWrap(raw: string): string {
  const s = raw.trim()
  let start = 0
  let end = s.length
  while (start < end && WRAP_CHARS.has(s[start])) start++
  while (end > start && WRAP_CHARS.has(s[end - 1])) end--
  return s.slice(start, end).trim()
}

// prompt 要求主题词 2-6 字，留一点富余避免把稍长但合理的主题词误伤；明显超长（多半是模型没
// 遵守格式、把解释性文字塞进来了）才丢弃，此时仍保留已解析出的作者。
const MAX_THEME_LEN = 8

// 沿用旧版 parseVerifiedAuthor 的判断依据：真实作者名不含句子标点、不是解释性长文本。
// 去掉了两个字符：
// - 顿号「、」——新格式里它是合法的多作者分隔符（如"岸见一郎、古贺史健"），不能再当
//   "这是一句话"的信号；
// - 半角句点「.」——西方作者名的缩写惯用法（如"J.K.罗琳"）天然带句点，句点出现在名字内部
//   不是"这是一句话"的信号，而全角句号「。」已经能覆盖中文语境下的句末场景，两者不必都拦。
// 换行仍然是強信号，保留在同一个正则里一并拒绝。
const AUTHOR_SENTENCE_PUNCTUATION = /[\n，。；：！？,;:!?]/
// 模型偶尔会诚实地回答"不确定/查不到"而不是按格式要求回 NO；这类措辞不含标点也很短，
// 光靠长度/标点过滤不掉，必须单独列出常见说法拒绝，否则会被当成一个"作者名"永久写库
// （upsertBook 用 update:{} 幂等写入，写错一次后面再也不会被更正）。
const AUTHOR_HEDGE_PHRASES = ['不确定', '未知', '无法确认', '不清楚', '抱歉']

function isRejectedAuthor(author: string): boolean {
  if (!author || /^no$/i.test(author)) return true
  if (author.length > 40) return true
  if (AUTHOR_SENTENCE_PUNCTUATION.test(author)) return true
  return AUTHOR_HEDGE_PHRASES.some((phrase) => author.includes(phrase))
}

/** 解析查证响应里的「作者|主题词」：取不到主题词时 theme 为 undefined；NO/空/无作者一律返回空对象 */
export function parseVerifiedBook(raw: string): { author?: string; theme?: string } {
  if (typeof raw !== 'string') return {}
  const trimmed = raw.trim()
  if (!trimmed) return {}
  if (/^no$/i.test(trimmed)) return {}

  const sepIdx = trimmed.indexOf('|')
  const authorRaw = sepIdx === -1 ? trimmed : trimmed.slice(0, sepIdx)
  const themeRaw = sepIdx === -1 ? '' : trimmed.slice(sepIdx + 1)

  const author = stripWrap(authorRaw)
  if (isRejectedAuthor(author)) return {}

  const result: { author?: string; theme?: string } = { author }
  const theme = stripWrap(themeRaw)
  if (theme && theme.length <= MAX_THEME_LEN) {
    result.theme = theme
  }
  return result
}

/** 候选书二次校验 prompt：只要求回 YES/NO */
export function buildVerifyCandidatePrompt(book: { title: string; author: string }): string {
  return `请判断《${book.title}》这本书是否真实存在，且作者是否为「${book.author}」。只回复 YES 或 NO，不要输出任何其它文字。`
}

export function parseYesNo(raw: string): boolean {
  return typeof raw === 'string' && /^\s*yes\b/i.test(raw.trim())
}

/**
 * 联网推荐同主题真实书目的 prompt，要求纯 JSON 数组。
 *
 * 两条约束都是线上事故换来的：
 *
 * 1. **必须中文书名**。原提示词对语言零约束，联网模型给回一屏英文书
 *    （《Jane Eyre: New Casebooks》《The Brontë Myth》…），书封快闪上全是英文。
 * 2. **必须是气质相近的「其它书」，不是「关于这本书的书」**。theme 在主题词提取失败时
 *    会回退成学员填的书名（见本文件 `parsed.theme ?? subject`），此时「与主题『简爱』相关」
 *    被模型完全合理地理解成「关于《简爱》的研究资料」，于是返回评论集、传记、导读、
 *    学术专著。这类书放进书单号视频里毫无意义。
 *
 * 这里不去修 theme 回退本身——主题词提取失败时我们确实没有更好的主题可用，
 * 与其编一个，不如让提示词对「theme 可能是书名」这种情况也成立。
 */
export function buildRecommendPrompt(theme: string, need: number): string {
  return [
    `请推荐 ${need} 本与主题「${theme}」气质相近、真实存在的书籍（不要虚构）。`,
    '硬性要求：',
    '1. 书名必须是中文；外文原著请使用通行的中文译名，不要给出外文原名。',
    '2. 必须是面向大众读者的经典或畅销读物，不要学术研究专著、论文集、评论集、导读或作家传记。',
    `3. 如果「${theme}」本身就是一本书的书名，请推荐主题与内涵相近的**其它书**，`,
    '   绝不要推荐研究、解读、评论、续写这本书的作品。',
    '严格以 JSON 数组格式输出，每个元素形如 {"title":"书名","author":"作者","points":"一句话推荐要点"}，不要输出 JSON 之外的任何文字或代码块标记。',
  ].join('\n')
}

// mock 模式固定夹具：不得走 llmComplete 通用 mock（那是无关的固定文案），本步骤自带真实书名。
const MOCK_BOOK_FIXTURE: BookOut[] = [
  { title: '活着', author: '余华', points: '苦难中的生命韧性' },
  { title: '被讨厌的勇气', author: '岸见一郎', points: '课题分离，为自己而活' },
  { title: '百年孤独', author: '加西亚·马尔克斯', points: '魔幻现实中的家族宿命' },
  { title: '小王子', author: '安托万·德·圣-埃克苏佩里', points: '成年人心底的纯真' },
  { title: '思考,快与慢', author: '丹尼尔·卡尼曼', points: '两套思维系统如何塑造决策' },
  { title: '人间失格', author: '太宰治', points: '边缘人格的自白书' },
  { title: '月亮与六便士', author: '威廉·萨默塞特·毛姆', points: '理想与世俗的取舍' },
  { title: '追风筝的人', author: '卡勒德·胡赛尼', points: '救赎与友谊的重量' },
]

/** mock 模式专用：纯函数，零网络/零 DB，学员那本固定排第一 */
export function buildMockBookList(subject: string, n: number): BookOut[] {
  const studentBook: BookOut = { title: normalizeTitleLocal(subject), author: '' }
  const rest = excludeBook(MOCK_BOOK_FIXTURE, studentBook).slice(0, Math.max(0, n - 1))
  return [studentBook, ...rest].slice(0, Math.max(1, n))
}

/** 解析学员输入：三级兜底。
 * 0. 库内精确命中 → 直接用（不发起任何联网调用）。
 * 1. 联网查证「作者|主题词」，失败或未拿到作者时重试一次（最多两次调用）。
 * 2. 仍无作者 → 从调用方传入的候选池里按 isSameBook 命中"全名版"，借用其 author/points。
 * 3. 仍无 → 书名用原文、作者留空，不写入 BookLibrary。
 * 返回同时带上本次采用的 theme（查证成功给出主题词则用它，否则回退 subject），供调用方在
 * collectCandidates 里统一用来做召回与写库，不再让主题词退化成学员的原始输入。 */
async function resolveStudentBook(subject: string, candidates: PickedBook[]): Promise<{ book: BookOut; theme: string }> {
  try {
    const hit = await findBookByTitle(subject)
    if (hit) {
      return {
        book: { title: hit.title, author: hit.author, ...(hit.points ? { points: hit.points } : {}) },
        theme: subject,
      }
    }
  } catch (err) {
    console.warn('[gen] select-books: findBookByTitle 失败，继续走联网查证', err)
  }

  let parsed: { author?: string; theme?: string } = {}
  for (let attempt = 0; attempt < 2 && !parsed.author; attempt++) {
    try {
      const raw = await llmComplete({ prompt: buildVerifySubjectPrompt(subject), enableSearch: true, maxTokens: 60 })
      parsed = parseVerifiedBook(raw)
    } catch (err) {
      console.warn('[gen] select-books: 学员输入联网查证失败', err)
      parsed = {}
    }
  }

  const theme = parsed.theme ?? subject
  let author = parsed.author ?? ''
  let points: string | undefined

  if (!author) {
    const match = candidates.find((c) => isSameBook({ title: subject, author: '' }, c))
    if (match) {
      author = match.author
      points = match.points
    }
  }

  if (!author) {
    return { book: { title: normalizeTitleLocal(subject), author: '' }, theme }
  }

  try {
    const saved = await upsertBook({ title: subject, author, theme, ...(points ? { points } : {}), source: 'ai' })
    return {
      book: { title: saved.title, author: saved.author, ...(saved.points ? { points: saved.points } : {}) },
      theme,
    }
  } catch (err) {
    console.warn('[gen] select-books: upsertBook(学员书) 失败，仍使用查证结果', err)
    return { book: { title: normalizeTitleLocal(subject), author, ...(points ? { points } : {}) }, theme }
  }
}

/** 候选池（陪衬书）：书库同主题召回 + 不足时联网推荐并二次校验；学员那本始终被排除在外（外层负责固定排末位） */
async function collectCandidates(theme: string, studentBook: BookOut, n: number): Promise<PickedBook[]> {
  let pool: PickedBook[] = []
  try {
    const rows = await findBooksByTheme(theme, n * 2)
    pool = rows.map((r) => ({ title: r.title, author: r.author, ...(r.points ? { points: r.points } : {}) }))
  } catch (err) {
    console.warn('[gen] select-books: findBooksByTheme 失败', err)
  }
  pool = excludeBook(pool, studentBook)

  const need = n - 1 - pool.length
  if (need > 0) {
    try {
      const raw = await llmComplete({ prompt: buildRecommendPrompt(theme, need), enableSearch: true, maxTokens: 800 })
      const recommended = dedupeBooks(parseBookList(raw))
      const verified: PickedBook[] = []
      for (const b of recommended) {
        let ok = false
        try {
          const yn = await llmComplete({ prompt: buildVerifyCandidatePrompt(b), enableSearch: true, maxTokens: 20 })
          ok = parseYesNo(yn)
        } catch (err) {
          console.warn('[gen] select-books: 候选书二次校验请求失败，剔除该本', b, err)
          continue
        }
        if (!ok) continue
        try {
          const saved = await upsertBook({ title: b.title, author: b.author, theme, ...(b.points ? { points: b.points } : {}), source: 'ai' })
          verified.push({ title: saved.title, author: saved.author, ...(saved.points ? { points: saved.points } : {}) })
        } catch (err) {
          console.warn('[gen] select-books: upsertBook(候选书) 失败，仍使用未沉淀结果', b, err)
          verified.push(b)
        }
      }
      pool = excludeBook(dedupeBooks([...pool, ...verified]), studentBook)
    } catch (err) {
      console.warn('[gen] select-books: 联网推荐候选书失败，仅使用书库候选', err)
    }
  }

  return pool
}

// themeBook 是下游判定「走单本文案」的唯一信号，且同时承载单本提示词与《书名》头所需的
// 书名/作者/要点——用一个字段兼任信号与数据，避免开关与数据两处失配。
// 不传（运营手填书单、manual/imitate、老任务重跑）时不写该字段，下游维持多本路径。
async function writeBooksAndEnqueue(
  genTaskId: string,
  variables: unknown,
  books: BookOut[],
  themeBook?: BookOut,
): Promise<void> {
  const vars: Record<string, unknown> =
    variables && typeof variables === 'object' && !Array.isArray(variables) ? { ...(variables as Record<string, unknown>) } : {}
  vars.books = books
  if (themeBook) vars.themeBook = themeBook
  await prisma.generationTask.update({ where: { id: genTaskId }, data: { variables: vars as never } })
  await enqueueGen('generate-script', { genTaskId })
}

export async function selectBooks(genTaskId: string): Promise<void> {
  const task = await prisma.generationTask.findUniqueOrThrow({
    where: { id: genTaskId },
    include: { framework: true },
  })

  // 规则1：运营已手填书单 → 原样跳过，直接入队，零回归关键路径。
  if (hasManualBooks(task.variables)) {
    await enqueueGen('generate-script', { genTaskId })
    return
  }

  // 规则4：manual/imitate 文案模式下 subject 不是书名/主题，AI 选书没有意义，
  // 且会浪费联网检索、有污染书库风险 → 同样原样跳过，直接入队。
  const scriptMode = readScriptMode(task.variables)
  if (scriptMode === 'manual' || scriptMode === 'imitate') {
    await enqueueGen('generate-script', { genTaskId })
    return
  }

  const subject = task.subject
  const n = resolveBookCount(task.framework.overlayTemplate)

  const cfg = await getCapabilityConfig('llm')
  if (isMockMode(cfg)) {
    // buildMockBookList 固定学员那本排第一（见其实现），这里取出后挪到末位，与真实路径一致：
    // 快闪最后一张定格在主题书。
    const mockBooks = buildMockBookList(subject, n)
    const mockThemeBook = mockBooks[0]
    const mockRest = mockBooks.slice(1)
    await writeBooksAndEnqueue(genTaskId, task.variables, [...mockRest, mockThemeBook], mockThemeBook)
    return
  }

  // 三级兜底第 2 级用的候选池：纯书库读取（零网络成本），此时学员输入还没查证出主题词，
  // 只能先按 subject 兜底召回——万一之前已有同名全名版沉淀在库里，靠 isSameBook 命中借作者。
  let fallbackCandidates: PickedBook[] = []
  try {
    const rows = await findBooksByTheme(subject, n * 2)
    fallbackCandidates = rows.map((r) => ({ title: r.title, author: r.author, ...(r.points ? { points: r.points } : {}) }))
  } catch (err) {
    console.warn('[gen] select-books: 学员书三级兜底候选池读取失败', err)
  }

  const { book: studentBook, theme } = await resolveStudentBook(subject, fallbackCandidates)

  // 快闪按 variables.books 顺序出卡，主题书排末位 = 最后一张定格在它。
  let books: BookOut[] = [studentBook]
  if (n > 1) {
    const pool = await collectCandidates(theme, studentBook, n)
    const picked = pickSubset(pool, n - 1, genTaskId)
    books = [...picked, studentBook]
  }

  await writeBooksAndEnqueue(genTaskId, task.variables, books, studentBook)
}
