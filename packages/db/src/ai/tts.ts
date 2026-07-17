import { getCapabilityConfig, isMockMode } from './config'
import { mockSilentWav } from './mock'
import { isDashScope, dashPost, fetchUrlToBuffer } from './dashscope'
import type { TtsOpts } from './types'

// CosyVoice / Qwen-Audio 声音复刻族的可用 target_model（核对自
// https://help.aliyun.com/zh/model-studio/voice-clone-design-http-api
// 与 https://help.aliyun.com/zh/model-studio/voice-clone-python-sdk）。
// 用于判断当前配置的合成模型是否属于「可用克隆音色」的一族。
function isCosyVoiceModel(model: string): boolean {
  const m = model.toLowerCase()
  return m.includes('cosyvoice') || m.includes('audio-3.0-tts') || m.includes('tts-vc')
}

export async function ttsSynthesize(opts: TtsOpts): Promise<Buffer> {
  const cfg = await getCapabilityConfig('tts')
  if (isMockMode(cfg)) return mockSilentWav(Math.max(1, Math.round(opts.text.length / 5)))

  const voiceId = opts.voiceId ?? (cfg.extra.voiceId as string | undefined)

  // 克隆音色合成：文档示例（voice-cloning-user-guide 的 qwen-tts curl 样例）显示克隆得到的
  // voice_id 与预置音色名一样，直接作为同一 multimodal-generation 端点的 input.voice 传入即可，
  // 无需换端点。这里仅在配置的模型属于 CosyVoice/Qwen-Audio 族时启用该分支（按任务约定）。
  if (isDashScope(cfg.baseUrl) && voiceId && isCosyVoiceModel(cfg.model)) {
    const data = await dashPost(cfg.baseUrl, cfg.apiKey, {
      model: cfg.model,
      input: { text: opts.text, voice: voiceId },
    })
    const url = (data.output as { audio?: { url?: string } })?.audio?.url
    if (typeof url !== 'string') throw new Error(`TTS(克隆音色) 返回格式异常: ${JSON.stringify(data).slice(0, 200)}`)
    return fetchUrlToBuffer(url)
  }

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
