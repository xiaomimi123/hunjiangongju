// 火山「豆包语音合成大模型2.0」单向流式 HTTP 适配器。
// 接口 POST https://openspeech.bytedance.com/api/v3/tts/unidirectional
// 头：X-Api-Key（语音技术控制台的 API Key）+ X-Api-Resource-Id（seed-tts-2.0）+ X-Api-Request-Id（uuid）。
// 体：{req_params:{text, speaker, audio_params:{format,sample_rate}, context_texts?:[语音指令]}}。
// 响应：HTTP Chunked 流，多个 JSON 对象拼接，每个 {code, data(base64 音频分片)}；拼接 data 即成品，code 非 0 为错误。
export function isVolcano(baseUrl: string): boolean {
  return typeof baseUrl === 'string' && baseUrl.includes('openspeech.bytedance.com')
}

export function buildVolcanoBody(
  text: string,
  speaker: string,
  opts?: { sampleRate?: number; emotionText?: string },
): object {
  const req_params: Record<string, unknown> = {
    text,
    speaker,
    audio_params: { format: 'mp3', sample_rate: opts?.sampleRate ?? 24000 },
  }
  // 语音指令（仅豆包2.0音色支持）：用自然语言控制语气/情绪。
  const emotion = opts?.emotionText?.trim()
  if (emotion) req_params.context_texts = [emotion]
  return { req_params }
}

export function buildVolcanoHeaders(apiKey: string, resourceId: string, requestId: string): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'X-Api-Key': apiKey,
    'X-Api-Resource-Id': resourceId,
    'X-Api-Request-Id': requestId,
  }
}

// 从拼接的多 JSON 对象响应里按大括号配平切出每个对象（兼容 NDJSON 与无分隔拼接；
// base64 音频不含大括号/引号，字符串态跟踪仅为稳妥）。
function splitJsonObjects(s: string): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = []
  let depth = 0, start = -1, inStr = false, esc = false
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (inStr) {
      if (esc) esc = false
      else if (c === '\\') esc = true
      else if (c === '"') inStr = false
      continue
    }
    if (c === '"') { inStr = true; continue }
    if (c === '{') { if (depth === 0) start = i; depth++ }
    else if (c === '}') {
      depth--
      if (depth === 0 && start >= 0) {
        try { out.push(JSON.parse(s.slice(start, i + 1))) } catch { /* 跳过不完整片段 */ }
        start = -1
      }
    }
  }
  return out
}

export function parseVolcanoStream(body: string): Buffer {
  const chunks: Buffer[] = []
  for (const obj of splitJsonObjects(String(body ?? ''))) {
    const code = obj.code as number | undefined
    if (typeof code === 'number' && code !== 0) {
      const message = obj.message as string | undefined
      throw new Error(`火山TTS错误 code=${code}${message ? ': ' + message : ''}`)
    }
    const data = obj.data as string | undefined
    if (typeof data === 'string' && data) chunks.push(Buffer.from(data, 'base64'))
  }
  if (chunks.length === 0) throw new Error(`火山TTS无音频返回: ${String(body).slice(0, 300)}`)
  return Buffer.concat(chunks)
}

function genRequestId(): string {
  const g = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto
  if (g && typeof g.randomUUID === 'function') return g.randomUUID()
  return `${Date.now()}-${Math.floor(Math.random() * 1e9)}`
}

export async function volcanoTtsSynthesize(o: {
  endpoint: string
  apiKey: string
  text: string
  speaker: string
  resourceId?: string
  sampleRate?: number
  emotionText?: string
  requestId?: string
}): Promise<Buffer> {
  const res = await fetch(o.endpoint, {
    method: 'POST',
    headers: buildVolcanoHeaders(o.apiKey, o.resourceId || 'seed-tts-2.0', o.requestId || genRequestId()),
    body: JSON.stringify(buildVolcanoBody(o.text, o.speaker, { sampleRate: o.sampleRate, emotionText: o.emotionText })),
  })
  const bodyText = await res.text()
  if (!res.ok) throw new Error(`火山TTS请求失败 ${res.status}: ${bodyText.slice(0, 300)}`)
  return parseVolcanoStream(bodyText)
}
