// 阿里云百炼（DashScope/通义千问）原生适配：文生图(qwen-image)、TTS(qwen-tts) 不支持 OpenAI 兼容，
// 走 DashScope 原生 multimodal-generation 接口，且返回的是「资源 URL」需再下载成字节。

export function isDashScope(baseUrl: string): boolean {
  const u = baseUrl.toLowerCase()
  return u.includes('dashscope') || u.includes('aliyuncs') || u.includes('bailian')
}

// 从用户填的 base（可能是 .../compatible-mode/v1 或裸域名）取 origin，拼原生生成端点
export function dashGenEndpoint(baseUrl: string): string {
  let origin = 'https://dashscope.aliyuncs.com'
  try { origin = new URL(baseUrl).origin } catch { /* 用默认 */ }
  return `${origin}/api/v1/services/aigc/multimodal-generation/generation`
}

// 声音复刻（CosyVoice/Qwen-Audio 建声）端点：核对自
// https://help.aliyun.com/zh/model-studio/voice-clone-design-http-api
// 文档给出的是按 Workspace 分域的 `{WorkspaceId}.cn-beijing.maas.aliyuncs.com` 域名，
// 但同页注明「legacy dashscope.aliyuncs.com 域名仍可正常使用」；本项目配置里没有单独的
// WorkspaceId 字段，因此统一走该 legacy 域名（与其余原生能力保持同一 baseUrl 来源）。
export function dashVoiceEnrollEndpoint(baseUrl: string): string {
  let origin = 'https://dashscope.aliyuncs.com'
  try { origin = new URL(baseUrl).origin } catch { /* 用默认 */ }
  return `${origin}/api/v1/services/audio/tts/customization`
}

// 下载 DashScope 返回的图片/音频 URL 为 Buffer（带超时，防挂起）
export async function fetchUrlToBuffer(url: string, timeoutMs = 60_000): Promise<Buffer<ArrayBuffer>> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch(url, { signal: ctrl.signal })
    if (!res.ok) throw new Error(`下载资源失败 ${res.status}`)
    return Buffer.from(await res.arrayBuffer())
  } finally {
    clearTimeout(timer)
  }
}

// endpoint 默认走 multimodal-generation（qwen-tts/qwen-image/asr 同步识别都用它）；
// 声音复刻建声走不同端点，调用方传 dashVoiceEnrollEndpoint(baseUrl) 覆盖。
export async function dashPost(
  baseUrl: string,
  apiKey: string,
  body: unknown,
  endpoint: string = dashGenEndpoint(baseUrl),
): Promise<{ output?: Record<string, unknown> }> {
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify(body),
  })
  const text = await res.text().catch(() => '')
  if (!res.ok) throw new Error(`DashScope 请求失败 ${res.status}: ${text.slice(0, 300)}`)
  try { return JSON.parse(text) } catch { throw new Error(`DashScope 返回非 JSON: ${text.slice(0, 200)}`) }
}
