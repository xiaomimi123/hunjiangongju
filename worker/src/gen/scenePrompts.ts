import { llmComplete, getCapabilityConfig, isMockMode } from '@mixcut/db'

// mock 模式固定场景池；describeScenes 的 mock 分支自带该 fixture，不经由 llmComplete 的通用 mock。
export const MOCK_SCENES = [
  '雨后窗台上打盹的橘猫，柔和晨光',
  '星空下的麦田小路，深蓝与金黄',
  '海边一棵孤独的老树，落日余晖',
]

/**
 * 让 LLM 把每段口播文案提炼成一句纯画面描述（生图提示词的主体部分）。
 * 文案原文是带货话术而非画面描述，直接塞给生图模型是噪音——这一步是画质的关键。
 */
export function buildSceneListPrompt(stylePrompt: string, texts: string[]): string {
  const lines = texts.map((t, i) => `${i + 1}. ${t}`).join('\n')
  return [
    `你是短视频美术指导。下面是一条竖屏视频的 ${texts.length} 段口播文案，为每一段设计一幅背景画面。`,
    `整体画风：${stylePrompt}`,
    '要求：',
    '- 每段输出一句具体的画面描述（20 字以内）：写清楚主体、环境、光线，能烘托该段文案的情绪',
    '- 只写画面，不复述文案；画面中不能出现人物、文字、书本',
    '- 各段画面要有变化，不要重复同一场景',
    `只输出一个 JSON 字符串数组，长度 ${texts.length}，不要任何其他内容。`,
    '文案：',
    lines,
  ].join('\n')
}

/** 解析 LLM 返回的场景数组：容忍代码围栏；无效条目为 null；定长 n（不足补 null，超出截断）。 */
export function parseSceneList(raw: string, n: number): (string | null)[] {
  const stripped = raw.replace(/```(?:json)?/g, '').trim()
  let arr: unknown
  try {
    arr = JSON.parse(stripped)
  } catch {
    arr = null
  }
  const list = Array.isArray(arr) ? arr : []
  return Array.from({ length: n }, (_, i) => {
    const v = list[i]
    return typeof v === 'string' && v.trim() ? v.trim() : null
  })
}

/**
 * 拼装单张生图提示词。有场景描述时用「画风+场景」；场景缺失（LLM 失败/解析失败）回退旧行为，
 * 用文案原文做意境引导。两条路径都保留禁文字约束（图上要叠字幕/书名贴片，图内文字会叠成乱码）。
 */
export function buildSegmentImagePrompt(stylePrompt: string, scene: string | null, scriptText: string): string {
  const subject = scene ?? `一个能烘托这种情绪的安静场景：${scriptText}`
  return [stylePrompt, subject, '纯画面，不出现任何文字、字幕或水印'].filter(Boolean).join('，')
}

/** 整任务一次 LLM 调用产出全部分镜场景。mock 模式循环使用固定场景池；真实调用失败时整组回退 null（fail-soft）。 */
export async function describeScenes(stylePrompt: string, texts: string[]): Promise<(string | null)[]> {
  const cfg = await getCapabilityConfig('llm')
  if (isMockMode(cfg)) return texts.map((_, i) => MOCK_SCENES[i % MOCK_SCENES.length])
  try {
    const raw = await llmComplete({ prompt: buildSceneListPrompt(stylePrompt, texts), maxTokens: 1000 })
    return parseSceneList(raw, texts.length)
  } catch (err) {
    console.warn(`[gen] describe-scenes 失败,回退文案意境引导: ${(err as Error).message?.slice(0, 100)}`)
    return texts.map(() => null)
  }
}
