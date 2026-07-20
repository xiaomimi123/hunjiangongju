import { getCapabilityConfig, isMockMode, type ResolvedCapConfig } from './config'
import { mockAsr } from './mock'
import { isDashScope, dashPost, fetchUrlToBuffer } from './dashscope'
import { dashAsyncSubmit, dashAsyncPoll } from './dashscopeAsync'
import type { AsrOpts, AsrResult } from './types'

// DashScope 录音文件识别的异步提交端点（Paraformer 与 qwen3-asr-flash-filetrans 共用）
const ASYNC_TRANSCRIPTION_PATH = '/api/v1/services/audio/asr/transcription'

// 纯解析函数：把 DashScope 录音文件识别结果（transcription_url 指向的 JSON）解析为 { fullText, sentences }。
// 真实结构（核对自 https://help.aliyun.com/zh/model-studio/paraformer-recorded-speech-recognition-restful-api）：
//   { transcripts: [{ text, sentences: [{ text, begin_time, end_time, words:[...] }] }] }
// 同时兼容扁平的 { sentences: [...] } 形态，便于单元测试与潜在的简化响应。
export function parseAsrResult(raw: any): AsrResult {
  const arr = raw?.transcripts?.[0]?.sentences ?? raw?.sentences ?? []
  const sentences = arr.map((s: any) => ({
    text: String(s?.text ?? ''),
    startMs: s?.begin_time ?? s?.start ?? 0,
    endMs: s?.end_time ?? s?.end ?? 0,
  }))
  const fullText = raw?.transcripts?.[0]?.text ?? sentences.map((s: { text: string }) => s.text).join('')
  return { fullText, sentences }
}

// 同步 qwen3-asr-flash：DashScope 原生 multimodal-generation，音频以 URL 传入 messages。
// 注意：官方文档确认该同步接口只返回识别文本，不带句级时间戳；因此整段文本作为唯一一句返回
// （startMs/endMs 均为 0，代表“未知/覆盖全段”）。需要真实句级时间戳请配置 paraformer-v2 或
// qwen3-asr-flash-filetrans（走下方异步路径）。
async function asrTranscribeSync(cfg: ResolvedCapConfig, audioUrl: string): Promise<AsrResult> {
  const data = await dashPost(cfg.baseUrl, cfg.apiKey, {
    model: cfg.model,
    input: {
      messages: [
        { role: 'system', content: [{ text: '' }] },
        { role: 'user', content: [{ audio: audioUrl }] },
      ],
    },
    parameters: { asr_options: { enable_itn: false } },
  })
  const message = (data.output as { choices?: { message?: { content?: unknown } }[] })?.choices?.[0]?.message
  const content = message?.content
  const text = typeof content === 'string'
    ? content
    : Array.isArray(content)
      ? content.map((c: { text?: string }) => c?.text ?? '').join('')
      : ''
  if (!text) throw new Error(`ASR 同步识别返回格式异常: ${JSON.stringify(data).slice(0, 200)}`)
  return { fullText: text, sentences: [{ text, startMs: 0, endMs: 0 }] }
}

// 异步 Paraformer / qwen3-asr-flash-filetrans：提交录音文件识别任务 → 轮询 → 下载 transcription_url → 解析。
async function asrTranscribeAsync(cfg: ResolvedCapConfig, audioUrl: string): Promise<AsrResult> {
  const taskId = await dashAsyncSubmit(cfg.baseUrl, cfg.apiKey, ASYNC_TRANSCRIPTION_PATH, {
    model: cfg.model,
    input: { file_urls: [audioUrl] },
    parameters: { channel_id: [0], language_hints: ['zh', 'en'] },
  })
  const output = await dashAsyncPoll(cfg.baseUrl, cfg.apiKey, taskId)
  const transcriptionUrl = output?.results?.[0]?.transcription_url
  if (typeof transcriptionUrl !== 'string') {
    throw new Error(`ASR 异步任务未返回 transcription_url: ${JSON.stringify(output).slice(0, 300)}`)
  }
  const buf = await fetchUrlToBuffer(transcriptionUrl)
  let raw: unknown
  try { raw = JSON.parse(buf.toString('utf-8')) } catch { throw new Error('ASR 转写结果非 JSON') }
  return parseAsrResult(raw)
}

export async function asrTranscribe(opts: AsrOpts): Promise<AsrResult> {
  const cfg = await getCapabilityConfig('asr')
  if (isMockMode(cfg)) return mockAsr()

  if (isDashScope(cfg.baseUrl)) {
    // 按配置的 model 分支：paraformer*/fun-asr*/*-filetrans → 异步录音文件识别（带真实句级时间戳）；
    // 其余（如 qwen3-asr-flash）→ 同步识别。
    const model = cfg.model.toLowerCase()
    const isAsync = /paraformer|fun-asr|filetrans/.test(model)
    return isAsync ? asrTranscribeAsync(cfg, opts.audioUrl) : asrTranscribeSync(cfg, opts.audioUrl)
  }

  // OpenAI 兼容默认（whisper 风格）：下载音频后按 multipart 上传
  const bytes = await fetchUrlToBuffer(opts.audioUrl)
  const form = new FormData()
  form.append('file', new Blob([bytes]), 'audio.wav')
  form.append('model', cfg.model)
  form.append('response_format', 'verbose_json')
  const res = await fetch(`${cfg.baseUrl.replace(/\/$/, '')}/audio/transcriptions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${cfg.apiKey}` },
    body: form,
  })
  if (!res.ok) throw new Error(`ASR 请求失败 ${res.status}: ${await res.text().catch(() => '')}`)
  const data = await res.json()
  const segments = Array.isArray(data?.segments) ? data.segments : []
  return {
    fullText: String(data?.text ?? ''),
    sentences: segments.map((s: { text: string; start: number; end: number }) => ({
      text: String(s.text ?? '').trim(),
      startMs: Math.round((s.start ?? 0) * 1000),
      endMs: Math.round((s.end ?? 0) * 1000),
    })),
  }
}
