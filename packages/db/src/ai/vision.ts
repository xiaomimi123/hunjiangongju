import { getCapabilityConfig, isMockMode } from './config'
import { isDashScope, dashPost } from './dashscope'

// 画风归类固定词表：厚涂油画 / 水彩插画 / 实拍照片 / 纯文字卡片 / AI 插画（默认兜底）
export type VisualStyleType = 'oil_painting' | 'watercolor' | 'photo' | 'text_card' | 'ai_illustration'
export type VisionStyleResult = { imageStylePrompt: string; visualStyleType: VisualStyleType }

const VISUAL_STYLE_TYPES: VisualStyleType[] = ['oil_painting', 'watercolor', 'photo', 'text_card', 'ai_illustration']

// mock 分支 / 解析彻底失败时的兜底默认值（沿用拆解此前硬编码的水彩插画之前的历史默认，
// 现在语义上代表"未能识别，视为厚涂油画"——与本任务约定的 mock 固定返回值一致）
export const MOCK_VISION_STYLE: VisionStyleResult = {
  imageStylePrompt: '厚涂油画质感,情绪化,统一画风',
  visualStyleType: 'oil_painting',
}

// 中文关键词 → visualStyleType 归类兜底（模型未按约定格式输出"分类：xxx"标签时使用）
const KEYWORD_MAP: [RegExp, VisualStyleType][] = [
  [/油画|厚涂/, 'oil_painting'],
  [/水彩/, 'watercolor'],
  [/实拍|写实|摄影|照片/, 'photo'],
  [/字卡|文字卡|纯文字/, 'text_card'],
]

function normalizeStyleType(raw: string | undefined): VisualStyleType | undefined {
  if (!raw) return undefined
  const s = raw.trim().toLowerCase().replace(/[^a-z_]/g, '')
  return (VISUAL_STYLE_TYPES as string[]).includes(s) ? (s as VisualStyleType) : undefined
}

// 提示词要求模型输出「画风描述：一句话」+「分类：词表词」两行；本函数做纯解析/归一化，
// 对不符合约定格式的输出也尽量兜底提取，绝不抛错（拆解流程不能因画风识别失败而中断）。
export function parseVisionStyle(raw: any): VisionStyleResult {
  try {
    const message = raw?.output?.choices?.[0]?.message
    const content = message?.content
    const text: string = typeof content === 'string'
      ? content
      : Array.isArray(content)
        ? content.map((c: { text?: string }) => c?.text ?? '').join('')
        : ''
    if (!text.trim()) return MOCK_VISION_STYLE

    const labelMatch = /分类[:：]\s*([a-zA-Z_]+)/.exec(text)
    let visualStyleType = normalizeStyleType(labelMatch?.[1])

    const descMatch = /画风描述[:：]\s*(.+)/.exec(text)
    let imageStylePrompt = descMatch?.[1]?.trim()

    if (!visualStyleType) {
      for (const [re, type] of KEYWORD_MAP) {
        if (re.test(text)) { visualStyleType = type; break }
      }
    }
    if (!visualStyleType) visualStyleType = 'ai_illustration'

    if (!imageStylePrompt) {
      const firstLine = text
        .split('\n')
        .map((l) => l.trim())
        .find((l) => l && !/^分类[:：]/.test(l))
      imageStylePrompt = firstLine ?? text.trim()
    }

    return { imageStylePrompt, visualStyleType }
  } catch {
    return MOCK_VISION_STYLE
  }
}

const VISION_INSTRUCTION =
  '请判断这些视频截图的整体画风。先用一句中文描述画风+媒介+情绪（以"画风描述："开头），' +
  '再另起一行输出分类（以"分类："开头），从以下词表中选一个：' +
  'oil_painting（厚涂油画）、watercolor（水彩插画）、photo（实拍照片）、' +
  'text_card（纯文字卡片）、ai_illustration（AI插画，都不像时选这个）。'

// qwen-vl 多模态画风识别：核对自 https://help.aliyun.com/zh/model-studio/vision
// DashScope 原生 multimodal-generation：input.messages[].content[] 里图片用 {"image": url} 传入，
// 响应文本在 output.choices[0].message.content[0].text。
export async function describeImageStyle(imageUrls: string[]): Promise<VisionStyleResult> {
  const cfg = await getCapabilityConfig('vision')
  if (isMockMode(cfg)) return MOCK_VISION_STYLE

  if (isDashScope(cfg.baseUrl)) {
    const content = [
      ...imageUrls.map((url) => ({ image: url })),
      { text: VISION_INSTRUCTION },
    ]
    const data = await dashPost(cfg.baseUrl, cfg.apiKey, {
      model: cfg.model,
      input: { messages: [{ role: 'user', content }] },
      parameters: {}, // qwen-vl multimodal-generation 要求 parameters 字段存在，否则 400 Field required
    })
    return parseVisionStyle(data)
  }

  // OpenAI 兼容默认（vision 模型走 chat/completions，image_url 结构）
  const res = await fetch(`${cfg.baseUrl.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.apiKey}` },
    body: JSON.stringify({
      model: cfg.model,
      messages: [
        {
          role: 'user',
          content: [
            ...imageUrls.map((url) => ({ type: 'image_url', image_url: { url } })),
            { type: 'text', text: VISION_INSTRUCTION },
          ],
        },
      ],
    }),
  })
  if (!res.ok) throw new Error(`画风识别请求失败 ${res.status}: ${await res.text().catch(() => '')}`)
  const data = await res.json()
  const text = data?.choices?.[0]?.message?.content
  return parseVisionStyle({ output: { choices: [{ message: { content: text } }] } })
}

const BOOKS_INSTRUCTION =
  '这些是一个「书单号」短视频的截图。请识别画面中作为主视觉/标题出现的书名与作者' +
  '（通常是顶部的《书名》和作者名——这是画面上的字，不是口播说的）。只输出一个 JSON 数组，' +
  '每项形如 {"title":"书名","author":"作者"}，作者识别不到就省略 author；一本书都没有就输出 []。' +
  '不要输出 JSON 以外的任何解释文字。'

// 从画面文本解析书目：模型可能输出带解释的文本，抠出其中的 JSON 数组。纯函数、绝不抛错。
export function parseBooksResult(raw: unknown): { title: string; author?: string }[] {
  try {
    const message = (raw as { output?: { choices?: { message?: { content?: unknown } }[] } })?.output?.choices?.[0]?.message
    const content = message?.content
    const text: string =
      typeof content === 'string'
        ? content
        : Array.isArray(content)
          ? (content as { text?: string }[]).map((c) => c?.text ?? '').join('')
          : ''
    const m = text.match(/\[[\s\S]*\]/)
    if (!m) return []
    const arr = JSON.parse(m[0]) as unknown
    if (!Array.isArray(arr)) return []
    const seen = new Set<string>()
    const out: { title: string; author?: string }[] = []
    for (const it of arr as { title?: unknown; author?: unknown }[]) {
      const title = typeof it?.title === 'string' ? it.title.replace(/[《》]/g, '').trim() : ''
      if (!title || seen.has(title)) continue
      seen.add(title)
      const author = typeof it?.author === 'string' && it.author.trim() ? it.author.trim() : undefined
      out.push(author ? { title, author } : { title })
    }
    return out
  } catch {
    return []
  }
}

// qwen-vl 从截图识别「书单号」主视觉里的书名/作者（画面文本，非口播）。mock/失败 → []。
export async function describeBooksFromImages(imageUrls: string[]): Promise<{ title: string; author?: string }[]> {
  const cfg = await getCapabilityConfig('vision')
  if (isMockMode(cfg)) return []
  try {
    if (isDashScope(cfg.baseUrl)) {
      const content = [...imageUrls.map((url) => ({ image: url })), { text: BOOKS_INSTRUCTION }]
      const data = await dashPost(cfg.baseUrl, cfg.apiKey, {
        model: cfg.model,
        input: { messages: [{ role: 'user', content }] },
        parameters: {},
      })
      return parseBooksResult(data)
    }
    const res = await fetch(`${cfg.baseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.apiKey}` },
      body: JSON.stringify({
        model: cfg.model,
        messages: [{ role: 'user', content: [...imageUrls.map((url) => ({ type: 'image_url', image_url: { url } })), { type: 'text', text: BOOKS_INSTRUCTION }] }],
      }),
    })
    if (!res.ok) return []
    const data = await res.json()
    return parseBooksResult({ output: { choices: [{ message: { content: data?.choices?.[0]?.message?.content } }] } })
  } catch {
    return []
  }
}
