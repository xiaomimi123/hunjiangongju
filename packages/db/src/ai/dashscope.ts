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

export async function dashPost(baseUrl: string, apiKey: string, body: unknown): Promise<{ output?: Record<string, unknown> }> {
  const res = await fetch(dashGenEndpoint(baseUrl), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify(body),
  })
  const text = await res.text().catch(() => '')
  if (!res.ok) throw new Error(`DashScope 请求失败 ${res.status}: ${text.slice(0, 300)}`)
  try { return JSON.parse(text) } catch { throw new Error(`DashScope 返回非 JSON: ${text.slice(0, 200)}`) }
}
