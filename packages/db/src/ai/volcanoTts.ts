// 火山「语音合成大模型2.0」V3单向流式HTTP适配器。响应 NDJSON, code===0 行 data 为 base64 音频分片。
export function isVolcano(baseUrl: string): boolean {
  return typeof baseUrl === 'string' && baseUrl.includes('openspeech.bytedance.com')
}
export function buildVolcanoBody(text: string, speaker: string, emotionText?: string): object {
  const req_params: Record<string, unknown> = {
    text, speaker, audio_params: { format: 'mp3', sample_rate: 24000 },
  }
  if (emotionText && emotionText.trim()) {
    req_params.additions = JSON.stringify({ context_texts: [emotionText.trim()] })
  }
  return { user: { uid: 'dongfangwenlan' }, req_params }
}
export function parseVolcanoAudio(ndjson: string): Buffer {
  const chunks: Buffer[] = []
  for (const line of String(ndjson ?? '').split('\n')) {
    const t = line.trim(); if (!t) continue
    let obj: { code?: number; data?: string; message?: string }
    try { obj = JSON.parse(t) } catch { continue }
    if (obj.code === 0 && typeof obj.data === 'string' && obj.data) chunks.push(Buffer.from(obj.data, 'base64'))
  }
  if (chunks.length === 0) throw new Error(`火山TTS无音频返回: ${String(ndjson).slice(-300)}`)
  return Buffer.concat(chunks)
}
export async function volcanoTtsSynthesize(o: {
  endpoint: string; appId: string; accessKey: string; resourceId: string
  text: string; speaker: string; emotionText?: string
}): Promise<Buffer> {
  const res = await fetch(o.endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Api-App-Id': o.appId,
      'X-Api-Access-Key': o.accessKey,
      'X-Api-Resource-Id': o.resourceId,
    },
    body: JSON.stringify(buildVolcanoBody(o.text, o.speaker, o.emotionText)),
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`火山TTS请求失败 ${res.status}: ${text.slice(0, 300)}`)
  return parseVolcanoAudio(text)
}
