import { prisma, llmComplete, validateScript, setGenerationStatus, enqueueGen } from '@mixcut/db'

const MAX_ATTEMPTS = 3

export async function generateScript(genTaskId: string): Promise<void> {
  const task = await prisma.generationTask.findUniqueOrThrow({
    where: { id: genTaskId },
    include: { framework: true },
  })
  const fw = task.framework

  const segCount = fw.suggestedSegmentCount ?? 8
  const maxLines = fw.maxLines ?? 21
  const maxTotalChars = fw.maxTotalChars ?? 220

  const variablesText =
    task.variables && Object.keys(task.variables as object).length > 0
      ? `\n可用变量（JSON）：${JSON.stringify(task.variables)}`
      : ''

  const basePrompt = [
    '你是一名短视频带货文案写手。请根据下面的「文案框架」和「主题」创作一条口播文案。',
    '',
    `文案框架：\n${fw.frameworkText}`,
    `主题：${task.subject}${variablesText}`,
    '',
    '要求：',
    `1. 分成 ${segCount} 段，每段单独一行，段与段之间用换行分隔。`,
    '2. 只输出文案正文，不要编号、不要标题、不要任何解释说明。',
    `3. 总字数不超过 ${maxTotalChars} 字，总行数不超过 ${maxLines} 行。`,
    '4. 严禁照搬原文或框架示例，必须围绕主题原创改写。',
  ].join('\n')

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
