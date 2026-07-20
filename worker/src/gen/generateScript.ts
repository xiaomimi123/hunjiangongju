import {
  prisma,
  llmComplete,
  validateScript,
  trimToBudget,
  splitCaptionPhrases,
  setGenerationStatus,
  enqueueGen,
  getCapabilityConfig,
  isMockMode,
} from '@mixcut/db'

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
const STYLE_RULES = [
  '文案风格准则（务必遵守）：',
  '- 开篇第一句直击情绪、给一个具体场景或画面，不要先介绍书或说"今天推荐"。',
  '- 短句、口语化、像跟朋友说话；多用具体细节，少用抽象大词。',
  '- 严禁"你是不是……"式营销开头、"不是……而是……"的对仗论证、机械排比。',
  '- 结尾留余味、给一句能被记住的话；严禁任何 CTA（买它/点购物车/关注/链接）。',
].join('\n')

export function buildScriptPrompt(args: {
  mode: 'books' | 'subject'
  subject: string
  books?: BookInput[]
  framework: ScriptFrameworkInput
  variablesText?: string
}): string {
  const { mode, subject, books, framework, variablesText = '' } = args
  const { frameworkText, segCount, maxLines, maxTotalChars } = framework

  if (mode === 'books') {
    const list = (books ?? []).map(formatBookLine).join('\n')
    return [
      '你是一名书单号短视频文案写手。请根据下面的「文案框架」，为以下书单逐句创作书评口吻的文案。',
      '',
      `文案框架：\n${frameworkText}`,
      `书单（共 ${books?.length ?? 0} 本）：\n${list}`,
      '',
      '要求：',
      '1. 按书单顺序为每本书逐句撰写书评文案，每句单独一行；语言需贴合书评人口吻，突出该书的核心价值与阅读理由。',
      '2. 只输出文案正文，不要编号、不要额外标题、不要任何解释说明。',
      `3. 总字数不超过 ${maxTotalChars} 字，总行数不超过 ${maxLines} 行，请依书目数量合理分配每本书的篇幅。`,
      '4. 严禁照搬书籍简介原文，必须围绕给定要点原创改写。',
      '',
      STYLE_RULES,
    ].join('\n')
  }

  return [
    '你是一名书单号短视频文案写手。请根据下面的「文案框架」和「选题」创作一条口播文案。',
    '',
    `文案框架：\n${frameworkText}`,
    `选题：${subject}${variablesText}`,
    '',
    '要求：',
    '1. 请先选书：在心里挑选 2-4 本与选题高度相关、适合书单号推荐的书籍（无需输出选书过程与书单本身），再围绕选定书目逐句撰写书评文案。',
    `2. 分成 ${segCount} 段，每段单独一行，段与段之间用换行分隔。`,
    '3. 只输出文案正文，不要编号、不要标题、不要选书清单、不要任何解释说明。',
    `4. 总字数不超过 ${maxTotalChars} 字，总行数不超过 ${maxLines} 行。`,
    '5. 严禁照搬原文或框架示例，必须围绕选题原创改写。',
    '',
    STYLE_RULES,
  ].join('\n')
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
export function assignBooksToSegments(lines: string[], books: BookInput[]): AssignedSegment[] {
  if (books.length === 0) return lines.map((scriptText) => ({ scriptText }))
  const idxs = allocateBookIndexes(lines.length, books.length)
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

  const resolved = resolveScriptMode(task.variables)
  let mode = resolved.mode
  let books = resolved.books
  // 改进3：从拆解框架生成时，若未手填书单但框架带有识别到的书目（overlayTemplate.books），
  // 自动采用 → 渲染《书名》头，无需运营每次手填。
  if (mode === 'subject') {
    const fwBooks = frameworkBooks(fw.overlayTemplate)
    if (fwBooks.length > 0) {
      mode = 'books'
      books = fwBooks
    }
  }

  const variablesText =
    task.variables && Object.keys(task.variables as object).length > 0
      ? `\n可用变量（JSON）：${JSON.stringify(task.variables)}`
      : ''

  const basePrompt = buildScriptPrompt({
    mode,
    subject: task.subject,
    books,
    framework: { frameworkText: fw.frameworkText, segCount, maxLines, maxTotalChars },
    variablesText,
  })

  let prompt = basePrompt
  let lastErrors: string[] = []
  let lastClean: string[] = []
  let clean: string[] | null = null

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const raw = await llmComplete({ prompt, maxTokens: 1200 })
    const lines = raw.split('\n')
    const result = validateScript(lines, maxLines, maxTotalChars)
    lastClean = result.clean

    if (result.errors.length === 0) {
      clean = result.clean
      break
    }

    lastErrors = result.errors
    // 追加压缩指令后重试
    prompt = `${basePrompt}\n\n上一次生成过长（${result.errors.join('；')}），请压缩到 ${maxLines} 行 / ${maxTotalChars} 字以内重写。`
  }

  if (!clean) {
    // 兜底：多次重试仍略超预算（真实 books 模式书评常见）→ 整行裁剪到预算内，不硬失败。
    if (lastClean.length === 0) {
      await setGenerationStatus(genTaskId, 'FAILED')
      throw new Error(`文案生成为空（已重试 ${MAX_ATTEMPTS} 次）：${lastErrors.join('；')}`)
    }
    clean = trimToBudget(lastClean, maxLines, maxTotalChars)
    console.warn(`[gen] generate-script ${genTaskId}: 超预算兜底裁剪 (${lastErrors.join('；')}) → ${clean.length} 行`)
  }

  const assigned = assignBooksToSegments(clean, books ?? [])

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
  for (let i = 0; i < assigned.length; i++) {
    const { scriptText, bookTitle, bookAuthor } = assigned[i]
    const phrases = splitCaptionPhrases(scriptText)
    const beats: { zh: string; en: string }[] = []
    for (const zh of phrases) beats.push({ zh, en: await translateLine(zh) })
    segments.push({
      generationTaskId: genTaskId,
      seqNo: i + 1,
      scriptText,
      ...(bookTitle ? { bookTitle } : {}),
      ...(bookAuthor ? { bookAuthor } : {}),
      subtitleEn: beats.map((b) => b.en).join(' '), // 整段英文=各拍拼接，供回退单条字幕用
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
