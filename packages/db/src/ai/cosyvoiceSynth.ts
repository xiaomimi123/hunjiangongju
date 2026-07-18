// CosyVoice 克隆音色合成：DashScope 上 CosyVoice 系模型没有 HTTP REST 合成接口，
// 只能走 WebSocket 双工协议（`wss://{host}/api-ws/v1/inference`）。
// 协议核对自官方文档（2026-07 抓取，字段名与示例均为文档原文）：
//   总览：      https://help.aliyun.com/zh/model-studio/cosyvoice-websocket-api
//   客户端事件： https://help.aliyun.com/zh/model-studio/cosyvoice-client-events
//   服务端事件： https://help.aliyun.com/zh/model-studio/cosyvoice-server-events
// 建声（enrollVoice）用的 target_model 与合成用的 model 必须一致——voice_id 前缀里已经
// 带着建声时的模型名（如 `cosyvoice-v2-xxxxx`），因此合成优先从 voiceId 里反推 model，
// 而不是用 tts 能力配置里可能填的 qwen-tts。
import WebSocket from 'ws'
import { randomUUID } from 'node:crypto'

export type CosyvoiceSynthOpts = {
  sampleRate?: number // 默认 22050，与文档示例一致；CosyVoice 支持 8000/16000/22050/24000/44100/48000
  volume?: number // 0-100，默认 50
  rate?: number // 语速，默认 1.0
  pitch?: number // 语调，默认 1.0
  timeoutMs?: number // 整个任务的超时（含建连+合成），默认 60s
}

const DEFAULT_TIMEOUT_MS = 60_000
const DEFAULT_SAMPLE_RATE = 22050

// 从配置的 baseUrl（可能是 `https://xxx.maas.aliyuncs.com/compatible-mode/v1` 或裸域名）
// 取 origin host，换协议为 wss，拼 CosyVoice 专用的 WebSocket 推理路径。
export function cosyvoiceWsUrl(baseUrl: string): string {
  let host = 'dashscope.aliyuncs.com'
  try { host = new URL(baseUrl).host } catch { /* 用默认 */ }
  return `wss://${host}/api-ws/v1/inference`
}

// voiceId 是否指向一个 CosyVoice 克隆音色（建声时 target_model 固定是 cosyvoice 系，
// 返回的 voice_id 形如 `cosyvoice-v2-<prefix>-<hex>`）。
export function isCosyvoiceVoiceId(voiceId: string | undefined): boolean {
  return typeof voiceId === 'string' && /^cosyvoice-/i.test(voiceId)
}

// 从 voiceId 前缀反推建声时的模型名（如 `cosyvoice-v2-vmrpxk11t-abbee2...` -> `cosyvoice-v2`）；
// 取不到时回退到 tts 能力配置里配的 model（若它本身就是 cosyvoice 系）。
export function resolveCosyvoiceModel(voiceId: string | undefined, cfgModel: string | undefined): string {
  const m = typeof voiceId === 'string' ? voiceId.match(/^(cosyvoice-v\d+)-/i) : null
  if (m) return m[1].toLowerCase()
  if (cfgModel && /^cosyvoice-/i.test(cfgModel)) return cfgModel
  return 'cosyvoice-v2'
}

export function buildRunTaskMessage(
  taskId: string,
  model: string,
  voiceId: string,
  opts: CosyvoiceSynthOpts = {},
): Record<string, unknown> {
  return {
    header: { action: 'run-task', task_id: taskId, streaming: 'duplex' },
    payload: {
      task_group: 'audio',
      task: 'tts',
      function: 'SpeechSynthesizer',
      model,
      parameters: {
        text_type: 'PlainText',
        voice: voiceId,
        format: 'pcm', // 流式传输选 pcm：逐帧原始采样，收全后自己拼 WAV 头，规避 wav/mp3 分帧编码不完整的问题
        sample_rate: opts.sampleRate ?? DEFAULT_SAMPLE_RATE,
        volume: opts.volume ?? 50,
        rate: opts.rate ?? 1.0,
        pitch: opts.pitch ?? 1.0,
      },
      input: {},
    },
  }
}

export function buildContinueTaskMessage(taskId: string, text: string): Record<string, unknown> {
  return {
    header: { action: 'continue-task', task_id: taskId, streaming: 'duplex' },
    payload: { input: { text } },
  }
}

export function buildFinishTaskMessage(taskId: string): Record<string, unknown> {
  return {
    header: { action: 'finish-task', task_id: taskId, streaming: 'duplex' },
    payload: { input: {} },
  }
}

// 把合成过程中逐帧收到的原始 PCM（16bit 有符号小端、单声道）拼成一个合法的 WAV 文件。
export function wrapPcmAsWav(pcm: Buffer, sampleRate: number, channels = 1, bitsPerSample = 16): Buffer {
  const blockAlign = channels * (bitsPerSample / 8)
  const byteRate = sampleRate * blockAlign
  const dataSize = pcm.length
  const header = Buffer.alloc(44)
  header.write('RIFF', 0); header.writeUInt32LE(36 + dataSize, 4); header.write('WAVE', 8)
  header.write('fmt ', 12); header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(channels, 22)
  header.writeUInt32LE(sampleRate, 24); header.writeUInt32LE(byteRate, 28)
  header.writeUInt16LE(blockAlign, 32); header.writeUInt16LE(bitsPerSample, 34)
  header.write('data', 36); header.writeUInt32LE(dataSize, 40)
  return Buffer.concat([header, pcm])
}

type ServerEvent = {
  header: { task_id: string; event: string; error_code?: string; error_message?: string }
  payload?: unknown
}

export async function cosyvoiceSynthesize(
  baseUrl: string,
  apiKey: string,
  model: string,
  voiceId: string,
  text: string,
  opts: CosyvoiceSynthOpts = {},
): Promise<Buffer> {
  const taskId = randomUUID()
  const sampleRate = opts.sampleRate ?? DEFAULT_SAMPLE_RATE
  const wsUrl = cosyvoiceWsUrl(baseUrl)

  return new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = []
    let settled = false
    const ws = new WebSocket(wsUrl, {
      headers: { Authorization: `Bearer ${apiKey}`, 'user-agent': 'mixcut-worker' },
    })

    const timer = setTimeout(() => {
      settle(() => reject(new Error(`CosyVoice 合成超时（${opts.timeoutMs ?? DEFAULT_TIMEOUT_MS}ms）`)))
    }, opts.timeoutMs ?? DEFAULT_TIMEOUT_MS)

    function settle(fn: () => void) {
      if (settled) return
      settled = true
      clearTimeout(timer)
      try { ws.close() } catch { /* 已关闭也无妨 */ }
      fn()
    }

    ws.on('open', () => {
      ws.send(JSON.stringify(buildRunTaskMessage(taskId, model, voiceId, opts)))
    })

    ws.on('message', (data: Buffer, isBinary: boolean) => {
      if (isBinary) {
        chunks.push(Buffer.from(data))
        return
      }
      let evt: ServerEvent
      try { evt = JSON.parse(data.toString('utf8')) } catch { return }
      const eventName = evt.header?.event
      if (eventName === 'task-started') {
        ws.send(JSON.stringify(buildContinueTaskMessage(taskId, text)))
        ws.send(JSON.stringify(buildFinishTaskMessage(taskId)))
      } else if (eventName === 'task-finished') {
        settle(() => resolve(wrapPcmAsWav(Buffer.concat(chunks), sampleRate)))
      } else if (eventName === 'task-failed') {
        settle(() => reject(new Error(`CosyVoice 合成失败 ${evt.header?.error_code ?? ''}: ${evt.header?.error_message ?? JSON.stringify(evt)}`)))
      }
      // result-generated（sentence-begin/synthesis/end）无需处理，音频数据走二进制帧
    })

    ws.on('error', (err: Error) => {
      settle(() => reject(new Error(`CosyVoice WebSocket 连接失败: ${err.message}`)))
    })

    ws.on('close', (code: number, reason: Buffer) => {
      settle(() => reject(new Error(`CosyVoice WebSocket 提前关闭 code=${code} reason=${reason?.toString() ?? ''}`)))
    })
  })
}
