import { getCapabilityConfig, isMockMode } from './config'
import { mockImagePng } from './mock'
import { isDashScope, dashPost, fetchUrlToBuffer } from './dashscope'
import type { ImageOpts } from './types'

export async function imageGenerate(opts: ImageOpts): Promise<Buffer> {
  const cfg = await getCapabilityConfig('image')
  if (isMockMode(cfg)) return mockImagePng()

  // 百炼 qwen-image：DashScope 原生 multimodal-generation，返回图片 URL
  if (isDashScope(cfg.baseUrl)) {
    const size = (cfg.extra.size as string) || '1024*1024' // qwen-image 用 W*H 格式；模板 cover 裁切自适应
    const data = await dashPost(cfg.baseUrl, cfg.apiKey, {
      model: cfg.model,
      input: { messages: [{ role: 'user', content: [{ text: opts.prompt }] }] },
      parameters: {
        size,
        watermark: false,
        prompt_extend: true,
        ...(opts.negativePrompt ? { negative_prompt: opts.negativePrompt } : {}),
      },
    })
    const content = (data.output as { choices?: { message?: { content?: { image?: string }[] } }[] })?.choices?.[0]?.message?.content
    const url = content?.find((c) => c.image)?.image
    if (typeof url !== 'string') throw new Error(`文生图返回格式异常: ${JSON.stringify(data).slice(0, 200)}`)
    return fetchUrlToBuffer(url)
  }

  // OpenAI 兼容默认
  const res = await fetch(`${cfg.baseUrl.replace(/\/$/, '')}/images/generations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.apiKey}` },
    body: JSON.stringify({ model: cfg.model, prompt: opts.prompt, size: opts.size ?? '1024x1792', response_format: 'b64_json' }),
  })
  if (!res.ok) throw new Error(`文生图请求失败 ${res.status}: ${await res.text().catch(() => '')}`)
  const data = await res.json()
  const b64 = data?.data?.[0]?.b64_json
  if (typeof b64 !== 'string') throw new Error('文生图返回格式异常')
  return Buffer.from(b64, 'base64')
}
