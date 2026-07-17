import { prisma, llmComplete, setSourceStatus, deriveCharBudget } from '@mixcut/db'

/** 已知行业标签，用于从 LLM 输出里做简单启发式命中 */
const INDUSTRY_LABELS = ['书单号', '好物推荐', '情感语录', '知识科普'] as const

/** 从 LLM 输出里解析行业标签；命中不到则默认「书单号」。绝不抛错。 */
function parseIndustry(text: string): string {
  try {
    for (const label of INDUSTRY_LABELS) {
      if (text.includes(label)) return label
    }
  } catch {
    /* 解析失败静默兜底 */
  }
  return '书单号'
}

/** 书名号后紧邻的作者标记：`/著`、`著`、`作者：`、`作者:`、`作者是` 等 */
const AUTHOR_NEAR_TITLE_RE = /^[\s，,、]*([一-龥·A-Za-z.\s]{2,20}?)\s*(?:\/\s*著|著)/
const AUTHOR_MARKER_RE = /作者[是：:]\s*([一-龥·A-Za-z.\s]{2,20}?)[，,。\s]/

/**
 * 纯正则从转写全文中识别书目（书名/作者），供「书单号」框架落地展示。
 * 无 LLM、无 DB 依赖，确定性输出，可单元测试。
 * - 书名：`《([^》]+)》`
 * - 作者：优先取书名后紧跟的 `/著`｜`著` 前缀词；否则在书名后一段窗口内找「作者：/作者是」标记。
 * - 按书名去重，保留首次出现顺序。
 */
export function extractBooks(transcript: string): { title: string; author?: string }[] {
  const results: { title: string; author?: string }[] = []
  const seen = new Set<string>()
  const titleRe = /《([^》]+)》/g
  let match: RegExpExecArray | null
  while ((match = titleRe.exec(transcript)) !== null) {
    const title = match[1].trim()
    if (!title || seen.has(title)) continue

    const after = transcript.slice(match.index + match[0].length, match.index + match[0].length + 40)
    let author: string | undefined

    const nearMatch = AUTHOR_NEAR_TITLE_RE.exec(after)
    if (nearMatch) {
      author = nearMatch[1].trim()
    } else {
      const markerMatch = AUTHOR_MARKER_RE.exec(after)
      if (markerMatch) author = markerMatch[1].trim()
    }

    seen.add(title)
    results.push(author ? { title, author } : { title })
  }
  return results
}

/**
 * LLM 提炼可复用文案框架：读最新 transcript + sceneCut → 组 prompt →
 * 产 frameworkText + 行业标签 → 代码按节奏估算阈值 → 建 CopyFramework → FRAMEWORK_READY。
 * 这是拆解流水线的终点，不再入队任何后续 job。
 */
/** 单个拆解 job 的墙钟保护，避免真 LLM 卡死占满并发 */
const EXTRACT_FRAMEWORK_TIMEOUT_MS = 120000

export async function extractFramework(sourceVideoId: string): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const work = extractFrameworkInner(sourceVideoId)
  try {
    await Promise.race([
      work,
      new Promise<never>((_, rej) => {
        timer = setTimeout(() => rej(new Error('extract-framework 超时')), EXTRACT_FRAMEWORK_TIMEOUT_MS)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

async function extractFrameworkInner(sourceVideoId: string): Promise<void> {
  const source = await prisma.sourceVideo.findUnique({ where: { id: sourceVideoId } })

  const transcript = await prisma.transcript.findFirst({
    where: { sourceVideoId },
    orderBy: { createdAt: 'desc' },
  })
  if (!transcript) throw new Error(`SourceVideo ${sourceVideoId} 缺少转写，无法提炼框架`)

  // SceneCut 无时间戳字段，按 id 取最新一条（每个 source 通常仅一条）
  const sceneCut = await prisma.sceneCut.findFirst({
    where: { sourceVideoId },
    orderBy: { id: 'desc' },
  })

  const fullText = transcript.fullText ?? ''

  // 段数：优先场景切点数，其次转写句数，再次默认 8；夹到 [3, 12]
  const cutCount = sceneCut?.cutPointsMs?.length ?? 0
  const sentenceCount = Array.isArray(transcript.sentences) ? transcript.sentences.length : 0
  let segCount = cutCount > 0 ? cutCount : sentenceCount > 0 ? sentenceCount : 8
  segCount = Math.max(3, Math.min(12, segCount))

  // LLM 提炼框架
  const system =
    '你是资深短视频文案策划。请从给定的口播转写中提炼出一套「可复用的文案框架」，' +
    '而不是复述原文。只输出框架描述，供后续套用到新选题。'
  const prompt =
    `以下是一条参考视频的口播全文（分为约 ${segCount} 段的节奏）：\n\n${fullText}\n\n` +
    `请输出一套可复用的文案框架，包含：\n` +
    `1. 开头句式（如何抓住注意力）\n` +
    `2. 段落逻辑（每段承担什么作用，共约 ${segCount} 段）\n` +
    `3. 语言风格（语气、节奏、常用词）\n` +
    `4. 建议分段数\n` +
    `并在结尾用一行标注该内容的行业标签，从以下选一个：书单号 / 好物推荐 / 情感语录 / 知识科普。`

  const llmOut = await llmComplete({ system, prompt })
  const frameworkText = llmOut && llmOut.trim() ? llmOut : `可复用文案框架（约 ${segCount} 段）：开头抛出钩子，逐段递进，结尾引导互动。`

  const industryCategory = parseIndustry(llmOut ?? '')

  // 阈值估算（代码侧，spec §8，从参考视频节奏反推，非 LLM）
  const textLen = Array.from(fullText).length
  const { maxLines, maxTotalChars } = deriveCharBudget(segCount, textLen)
  const imageStylePrompt = '治愈系水彩插画，暖色调，柔和光线，统一画风'

  // 书单号核心：从真实转写中识别源里提到的书目（书名/作者），供后续渲染引用
  const books = extractBooks(fullText)
  const overlayTemplate = {
    title_card: '{{标题}} {{副标题}}',
    watermark: '{{账号}}',
    ...(books.length > 0 ? { books } : {}),
  }

  await prisma.copyFramework.create({
    data: {
      sourceVideoId,
      name: `拆解框架-${sourceVideoId.slice(0, 8)}`,
      industryCategory,
      frameworkText,
      suggestedSegmentCount: segCount,
      maxLines,
      maxTotalChars,
      imageStylePrompt,
      overlayTemplate,
      renderTemplate: 'booklist',
      visualStyleType: 'ai_illustration',
      createdBy: source?.createdBy ?? null,
    },
  })

  await setSourceStatus(sourceVideoId, 'FRAMEWORK_READY')
}
