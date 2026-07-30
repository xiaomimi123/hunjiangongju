import { getCapabilityConfig, isMockMode } from './config'
import { mockSilentWav } from './mock'
import { isDashScope, dashPost, fetchUrlToBuffer } from './dashscope'
import { isCosyvoiceVoiceId, resolveCosyvoiceModel, cosyvoiceSynthesize } from './cosyvoiceSynth'
import { isVolcano, volcanoTtsSynthesize } from './volcanoTts'
import { TTS_VOICES } from './ttsVoices'
import type { TtsOpts } from './types'

// 构造 DashScope 原生 multimodal-generation 的 TTS 请求体（纯函数，便于单测）。
// 克隆音色合成：文档示例（voice-cloning-user-guide 的 qwen-tts curl 样例）显示克隆得到的
// voice_id 与预置音色名一样，直接作为同一端点的 input.voice 传入即可，无需换端点、
// 也无需限定合成模型属于某个「CosyVoice」名族——只要调用方选定了 voiceId 就应当被采用，
// 否则回退到显式指定的 voice，再否则回退默认 'Cherry'。
export function buildDashTtsBody(
  model: string,
  text: string,
  voiceId: string | undefined,
  voice: string | undefined,
): { model: string; input: { text: string; voice: string } } {
  return { model, input: { text, voice: voiceId ?? voice ?? 'Cherry' } }
}

export async function ttsSynthesize(opts: TtsOpts): Promise<Buffer> {
  const cfg = await getCapabilityConfig('tts')
  if (isMockMode(cfg)) return mockSilentWav(Math.max(1, Math.round(opts.text.length / 5)))

  // 火山「豆包语音合成大模型2.0」单向流式：baseUrl 指向 openspeech.bytedance.com 时走此适配器。
  // 配置映射：接口地址=baseUrl(/api/v3/tts/unidirectional)、模型=X-Api-Resource-Id(seed-tts-2.0)、
  // 密钥=X-Api-Key(语音技术控制台的 API Key)。情感语气用 extra.emotion(自然语言)。
  if (isVolcano(cfg.baseUrl)) {
    const speaker = opts.voice ?? (cfg.extra.voice as string) ?? TTS_VOICES[0].id
    return volcanoTtsSynthesize({
      endpoint: cfg.baseUrl,
      apiKey: cfg.apiKey,
      resourceId: cfg.model || 'seed-tts-2.0',
      text: opts.text,
      speaker,
      sampleRate: 24000,
      emotionText: (cfg.extra.emotion as string) || undefined,
    })
  }

  const voiceId = opts.voiceId ?? (cfg.extra.voiceId as string | undefined)

  // CosyVoice 克隆音色：DashScope 上 CosyVoice 系模型没有 HTTP REST 合成接口，只能走
  // WebSocket 协议（见 cosyvoiceSynth.ts）。建声时 target_model 与合成时 model 必须一致，
  // 因此优先从 voiceId 前缀反推模型名，而不是盲目套用 tts 能力配置里可能填的 qwen-tts。
  if (isCosyvoiceVoiceId(voiceId) || /^cosyvoice-/i.test(cfg.model)) {
    const model = resolveCosyvoiceModel(voiceId, cfg.model)
    if (!voiceId) throw new Error('CosyVoice 合成模型需要指定克隆音色 voiceId')
    return cosyvoiceSynthesize(cfg.baseUrl, cfg.apiKey, model, voiceId, opts.text)
  }

  // 百炼 qwen-tts：DashScope 原生 multimodal-generation，返回音频 URL。
  // voiceId 存在时即视为「克隆音色」并直接使用，与合成模型名无关（见 buildDashTtsBody 注释）。
  if (isDashScope(cfg.baseUrl)) {
    const voice = opts.voice ?? (cfg.extra.voice as string | undefined)
    const body = buildDashTtsBody(cfg.model, opts.text, voiceId, voice)
    const data = await dashPost(cfg.baseUrl, cfg.apiKey, body)
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
