import { prisma, llmComplete, validateScript, setGenerationStatus, enqueueGen } from '@mixcut/db'

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
  ].join('\n')
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

  const { mode, books } = resolveScriptMode(task.variables)

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
  let clean: string[] | null = null

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const raw = await llmComplete({ prompt, maxTokens: 1200 })
    const lines = raw.split('\n')
    const result = validateScript(lines, maxLines, maxTotalChars)

    if (result.errors.length === 0) {
      clean = result.clean
      break
    }

    lastErrors = result.errors
    // 追加压缩指令后重试
    prompt = `${basePrompt}\n\n上一次生成过长（${result.errors.join('；')}），请压缩到 ${maxLines} 行 / ${maxTotalChars} 字以内重写。`
  }

  if (!clean) {
    await setGenerationStatus(genTaskId, 'FAILED')
    throw new Error(`文案校验失败（已重试 ${MAX_ATTEMPTS} 次）：${lastErrors.join('；')}`)
  }

  const segments = clean.map((scriptText, i) => ({
    generationTaskId: genTaskId,
    seqNo: i + 1,
    scriptText,
  }))

  await prisma.$transaction([
    // 幂等：先清旧段再写新段
    prisma.generatedSegment.deleteMany({ where: { generationTaskId: genTaskId } }),
    prisma.generatedSegment.createMany({ data: segments }),
  ])

  await setGenerationStatus(genTaskId, 'IMAGE_GENERATING')
  await enqueueGen('generate-image', { genTaskId })
}
