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

/**
 * OpenAI 兼容模式的 base（`.../compatible-mode/v1`）。
 *
 * 用户填的 base 有两种形态：MAAS 专属端点已经带 `/compatible-mode/v1`，
 * 而 `https://dashscope.aliyuncs.com` 是裸域名。列模型走的是兼容模式的 `/models`，
 * 两种都要能拼对。
 */
export function dashCompatBase(baseUrl: string): string {
  const trimmed = (baseUrl || '').replace(/\/+$/, '')
  if (/\/compatible-mode\/v\d+$/.test(trimmed)) return trimmed
  let origin = 'https://dashscope.aliyuncs.com'
  try { origin = new URL(trimmed).origin } catch { /* 用默认 */ }
  return `${origin}/compatible-mode/v1`
}

/**
 * 列出该端点可用的模型 id。
 *
 * 换模型不该靠猜名字：「Model not exist」既可能是名字写错、也可能是这个端点
 * 根本不服务该模型（MAAS 专属端点只服务你部署上去的那几个）。列一遍就不用猜了。
 */
export async function dashListModels(baseUrl: string, apiKey: string, timeoutMs = 20_000): Promise<string[]> {
  const url = `${dashCompatBase(baseUrl)}/models`
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${apiKey}` }, signal: ctrl.signal })
    const text = await res.text().catch(() => '')
    if (!res.ok) throw new Error(`列模型失败 ${res.status}（${url}）: ${text.slice(0, 200)}`)
    const json = JSON.parse(text) as { data?: { id?: unknown }[] }
    return (json.data ?? [])
      .map((m) => m?.id)
      .filter((id): id is string => typeof id === 'string' && !!id)
      .sort()
  } finally {
    clearTimeout(timer)
  }
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
  timeoutMs = 150_000,
): Promise<{ output?: Record<string, unknown> }> {
  // 客户端超时：文生图等偶发挂起时 DashScope 网关要 ~298s 才 504，太久拖垮上层重试。
  // 提前在 150s 主动中止 → 抛错 → 由调用方(如 generate-image withRetry)更快重试。
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  let res: Response
  try {
    res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    })
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw new Error(`DashScope 请求超时（${timeoutMs}ms）`)
    throw e
  } finally {
    clearTimeout(timer)
  }
  const text = await res.text().catch(() => '')
  if (!res.ok) {
    // 一定要带上**端点**与**模型名**：换模型时最常见的失败是「Model not exist」，
    // 而它既可能是模型名写错，也可能是这个端点不服务该模型 —— 少了这两条信息没法区分。
    const model = (body as { model?: unknown } | null)?.model
    throw new Error(
      `DashScope 请求失败 ${res.status}（端点 ${endpoint}，模型 ${String(model ?? '(未指定)')}）: ${text.slice(0, 300)}`,
    )
  }
  try { return JSON.parse(text) } catch { throw new Error(`DashScope 返回非 JSON: ${text.slice(0, 200)}`) }
}
