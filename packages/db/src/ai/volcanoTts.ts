// 火山「音频生成HTTP」(豆包 seed-audio-1.0) 适配器。
// 同步接口 POST /api/v3/tts/create，新版控制台 X-Api-Key 单头鉴权。
// 请求体 {model, text_prompt, references:[{speaker}], audio_config, watermark}；
// 同步返回 JSON：成功给 audio(base64) 或 url(2h有效)，失败给 code(非0)+message。
export function isVolcano(baseUrl: string): boolean {
  return typeof baseUrl === 'string' && baseUrl.includes('openspeech.bytedance.com')
}

// 构造 /tts/create 请求体。emotionText 以自然语言前置到 text_prompt（模型按语气描述合成，不会读出括号内容）。
export function buildVolcanoBody(
  text: string,
  speaker: string,
  opts?: { model?: string; sampleRate?: number; emotionText?: string },
): object {
  const emotion = opts?.emotionText?.trim()
  const text_prompt = emotion ? `（${emotion}）${text}` : text
  return {
    model: opts?.model || 'seed-audio-1.0',
    text_prompt,
    references: [{ speaker }],
    audio_config: { format: 'mp3', sample_rate: opts?.sampleRate ?? 24000 },
    watermark: {},
  }
}

// 解析同步返回：优先 audio(base64)，否则给 url 待下载；有非0 code 或两者皆无则抛错。
export function parseVolcanoCreate(json: unknown): { audio?: Buffer; url?: string } {
  const obj = (json ?? {}) as { code?: number; message?: string; audio?: string; url?: string }
  if (typeof obj.code === 'number' && obj.code !== 0) {
    throw new Error(`火山TTS错误 code=${obj.code}${obj.message ? ': ' + obj.message : ''}`)
  }
  if (typeof obj.audio === 'string' && obj.audio) return { audio: Buffer.from(obj.audio, 'base64') }
  if (typeof obj.url === 'string' && obj.url) return { url: obj.url }
  throw new Error(`火山TTS无音频返回: ${JSON.stringify(json).slice(0, 300)}`)
}

// 鉴权头：语音技术控制台有两种凭据。
// - 新版：单头 X-Api-Key（apiKey）。
// - 旧版：双头 X-Api-App-Id(appId) + X-Api-Access-Key(apiKey=Access Token)。
// 传了 appId 就走旧版双头，否则走新版单头。
export function buildVolcanoHeaders(apiKey: string, appId?: string, requestId?: string): Record<string, string> {
  const h: Record<string, string> = { 'Content-Type': 'application/json' }
  if (appId && appId.trim()) {
    h['X-Api-App-Id'] = appId
    h['X-Api-Access-Key'] = apiKey
  } else {
    h['X-Api-Key'] = apiKey
  }
  if (requestId) h['X-Api-Request-Id'] = requestId
  return h
}

export async function volcanoTtsSynthesize(o: {
  endpoint: string
  apiKey: string
  text: string
  speaker: string
  appId?: string
  model?: string
  sampleRate?: number
  emotionText?: string
  requestId?: string
}): Promise<Buffer> {
  const res = await fetch(o.endpoint, {
    method: 'POST',
    headers: buildVolcanoHeaders(o.apiKey, o.appId, o.requestId),
    body: JSON.stringify(
      buildVolcanoBody(o.text, o.speaker, { model: o.model, sampleRate: o.sampleRate, emotionText: o.emotionText }),
    ),
  })
  const bodyText = await res.text()
  if (!res.ok) throw new Error(`火山TTS请求失败 ${res.status}: ${bodyText.slice(0, 300)}`)
  let json: unknown
  try { json = JSON.parse(bodyText) } catch { throw new Error(`火山TTS返回非JSON: ${bodyText.slice(0, 300)}`) }
  const parsed = parseVolcanoCreate(json)
  if (parsed.audio) return parsed.audio
  // 返回的是带过期时间的 URL，下载音频字节
  const audioRes = await fetch(parsed.url as string)
  if (!audioRes.ok) throw new Error(`火山TTS音频下载失败 ${audioRes.status}`)
  return Buffer.from(await audioRes.arrayBuffer())
}
