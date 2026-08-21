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

// ── 参考图反推「生图用的画风提示词」 ──
//
// 与 describeImageStyle 的区别：那个是给**拆解**用的，目标是把源视频归到 5 类词表里，
// 只输出一句话概括（「厚涂油画质感,情绪化,统一画风」）。这个是给**生图**用的，
// 目标是把参考图的风格描述到足以复现——媒介、笔触、色调、光线、构图、情绪都要有。
// 一句话概括喂给文生图模型是出不来对应风格的。

/**
 * **只在 mock 模式**用的固定返回值。
 *
 * 它不再兼作「解析失败兜底」：兜底一句「厚涂油画质感,浓郁色彩…」看起来完全像一次
 * 正常的反推结果，运营拿到手分不清是模型真读了图、还是这一步悄悄失败了。
 * 传一张动漫头像回来一句厚涂油画，比直接报错更难排查。解析不出来就抛，让它可见。
 */
export const MOCK_STYLE_PROMPT = '厚涂油画质感,浓郁色彩,可见笔触,柔和光线,古典氛围'

const STYLE_PROMPT_INSTRUCTION =
  '你是一名 AI 绘画提示词工程师。请观察这张参考图，输出一句可直接用于文生图的中文提示词，' +
  '目标是让文生图模型画出**同样风格**的图。' +
  '要覆盖：艺术媒介或流派、笔触与质感、主色调与配色关系、光线特征、整体情绪。' +
  // 人物图必须带上主体与景别。第一版写的是「只描述风格，不要描述人物」，
  // 结果动漫头像反推回来是一句纯风格词，拿去生图会被带偏成风景——
  // 对头像类参考图来说「是人物、什么性别、什么景别」本身就是要复现的东西。
  '若参考图的主体是人物，必须写明**性别**与**景别**（如「男性少年面部特写」「女性半身像」）；' +
  '只写「动漫头像」而不写性别时，模型默认产出女性角色。' +
  '若主体是风景或静物，则不要写具体物体，只描述风格。' +
  // 但仍然不能带具体情节：这句提示词会被复用到别的片子上
  '任何情况下都不要描述具体场景、道具或情节（如「躲在被子里」「手里拿着书」）。' +
  '用逗号分隔的短语，不超过 60 字。直接输出提示词本身，不要任何解释、前缀或引号。'

/**
 * 从模型返回里取出提示词并做清洗。
 * @returns 提取不到可用内容时返回 null —— 由调用方决定怎么报。
 *   **不要**在这里兜一句通用画风：那会让「这一步失败了」伪装成一次正常结果。
 */
export function parseStylePrompt(raw: any): string | null {
  try {
    const message = raw?.output?.choices?.[0]?.message
    const content = message?.content
    let text: string = typeof content === 'string'
      ? content
      : Array.isArray(content)
        ? content.map((c: { text?: string }) => c?.text ?? '').join('')
        : (raw?.choices?.[0]?.message?.content ?? '')
    text = String(text ?? '').trim()
    // 模型偶尔会加「画风提示词：」这类前缀或整句加引号，一并剥掉
    // 引号要**首尾各剥一次**：不加 g 的 replace 只换第一处，结尾那个会留着。
    // 字符集必须含中文弯引号（模型十有八九给的是 “”），漏了等于没剥。
    text = text.replace(/^[^：:]{0,12}[：:]\s*/, '').trim()
    text = text.replace(/^["'「『“]/, '').replace(/["'」』”]$/, '').trim()
    // 只取第一段：偶尔会追加一段解释
    text = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)[0] ?? ''
    return text || null
  } catch {
    return null
  }
}

/**
 * 参考图 → 生图用的画风提示词。
 * @param imageUrls 参考图的**公网可达** URL（百炼要自己去拉，本机路径不行）
 */
export async function describeStyleForPrompt(imageUrls: string[]): Promise<string> {
  const cfg = await getCapabilityConfig('vision')
  // mock 必须在这一层自己兜底：这是一条新的 vision 用法，不能借道 describeImageStyle
  // 的 mock（那个返回的是拆解用的一句话概括，语义不同）
  if (isMockMode(cfg)) return MOCK_STYLE_PROMPT

  if (isDashScope(cfg.baseUrl)) {
    const content = [...imageUrls.map((url) => ({ image: url })), { text: STYLE_PROMPT_INSTRUCTION }]
    const data = await dashPost(cfg.baseUrl, cfg.apiKey, {
      model: cfg.model,
      input: { messages: [{ role: 'user', content }] },
      parameters: {},
    })
    const out = parseStylePrompt(data)
    if (!out) throw new Error(`vision 未返回可用的画风提示词（响应：${JSON.stringify(data).slice(0, 300)}）`)
    return out
  }

  const res = await fetch(`${cfg.baseUrl.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.apiKey}` },
    body: JSON.stringify({
      model: cfg.model,
      messages: [{
        role: 'user',
        content: [
          ...imageUrls.map((url) => ({ type: 'image_url', image_url: { url } })),
          { type: 'text', text: STYLE_PROMPT_INSTRUCTION },
        ],
      }],
    }),
  })
  if (!res.ok) throw new Error(`vision 反推画风失败 ${res.status}: ${(await res.text()).slice(0, 200)}`)
  const json = await res.json()
  const out = parseStylePrompt(json)
  if (!out) throw new Error(`vision 未返回可用的画风提示词（响应：${JSON.stringify(json).slice(0, 300)}）`)
  return out
}
