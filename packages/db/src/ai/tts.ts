import { getCapabilityConfig, isMockMode } from './config'
import { mockSilentWav } from './mock'
import { isDashScope, dashPost, fetchUrlToBuffer } from './dashscope'
import type { TtsOpts } from './types'

export async function ttsSynthesize(opts: TtsOpts): Promise<Buffer> {
  const cfg = await getCapabilityConfig('tts')
  if (isMockMode(cfg)) return mockSilentWav(Math.max(1, Math.round(opts.text.length / 5)))

  // 百炼 qwen-tts：DashScope 原生 multimodal-generation，返回音频 URL
  if (isDashScope(cfg.baseUrl)) {
    const voice = opts.voice ?? (cfg.extra.voice as string) ?? 'Cherry'
    const data = await dashPost(cfg.baseUrl, cfg.apiKey, {
      model: cfg.model,
      input: { text: opts.text, voice },
    })
    const url = (data.output as { audio?: { url?: string } })?.audio?.url
    if (typeof url !== 'string') throw new Error(`TTS 返回格式异常: ${JSON.stringify(data).slice(0, 200)}`)
    return fetchUrlToBuffer(url)
  }

  // OpenAI 兼容默认
  const res = await fetch(`${cfg.baseUrl.replace(/\/$/, '')}/audio/speech`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.apiKey}` },
    body: JSON.stringify({ model: cfg.model, input: opts.text, voice: opts.voice ?? (cfg.extra.voice as string) ?? 'alloy' }),
  })
  if (!res.ok) throw new Error(`TTS 请求失败 ${res.status}: ${await res.text().catch(() => '')}`)
  return Buffer.from(await res.arrayBuffer())
}
