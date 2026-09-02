// 扣子(Coze) API 客户端：运行工作流 / 上传文件 / 拉取工作流参数定义。
//
// 请求/响应形状按扣子公开文档预写（工作流运行 POST /v1/workflow/run、文件上传 POST /v1/files/upload、
// 工作流详情 GET /v1/workflows/{workflow_id}）——Task 1 的真实 API 验证 spike 被裁定延后，
// spike 补做后如与本文件不符，以实测为准。
//
// 扣子标准响应包裹为 { code, msg, data }，code !== 0 时抛中文错误并带上 msg。
// data 在 run 接口里常见为 JSON 字符串（工作流的输出被序列化成字符串装进 data），
// 本文件不解析 data ——原样放进 { raw } 返回；把它解析成结构化结果是 Task 4 纯函数的职责，
// 客户端只管请求与错误处理，两者职责不混在一起。

import { getCapabilityConfig } from './config'

export type CozeFetch = typeof fetch

type CozeEnvelope = { code?: unknown; msg?: unknown; data?: unknown }

async function getCozeCfg(): Promise<{ baseUrl: string; apiKey: string }> {
  const cfg = await getCapabilityConfig('coze')
  if (!cfg.enabled || !cfg.baseUrl || !cfg.apiKey) {
    throw new Error('扣子未配置，请在模型配置里填 Token')
  }
  return { baseUrl: cfg.baseUrl.replace(/\/+$/, ''), apiKey: cfg.apiKey }
}

// 是否为超时/中止错误（AbortSignal.timeout 触发时抛出 DOMException('TimeoutError')，
// 手动 abort 时是 'AbortError'，两者都当作超时处理）
function isAbortLike(e: unknown): boolean {
  const name = (e as { name?: unknown } | null)?.name
  return name === 'TimeoutError' || name === 'AbortError'
}

// 解析扣子标准包裹：HTTP 非 2xx 或 code !== 0 都抛中文错误（带上响应体/msg）。
async function parseCozeEnvelope(res: Response, action: string): Promise<CozeEnvelope> {
  const text = await res.text().catch(() => '')
  if (!res.ok) {
    throw new Error(`扣子${action}请求失败 ${res.status}: ${text.slice(0, 300)}`)
  }
  let json: CozeEnvelope
  try { json = JSON.parse(text) } catch { throw new Error(`扣子返回非 JSON: ${text.slice(0, 200)}`) }
  const code = typeof json.code === 'number' ? json.code : 0
  if (code !== 0) {
    throw new Error(`扣子${action}失败: ${String(json.msg ?? '未知错误')}`)
  }
  return json
}

export async function cozeRunWorkflow(
  workflowId: string,
  parameters: Record<string, unknown>,
  opts?: { fetchImpl?: CozeFetch; timeoutMs?: number },
): Promise<{ raw: unknown }> {
  const { baseUrl, apiKey } = await getCozeCfg()
  const fetchImpl = opts?.fetchImpl ?? fetch
  const timeoutMs = opts?.timeoutMs ?? 10 * 60_000 // 工作流运行可能较慢，默认 10 分钟
  let res: Response
  try {
    res = await fetchImpl(`${baseUrl}/v1/workflow/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ workflow_id: workflowId, parameters }),
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch (e) {
    if (isAbortLike(e)) throw new Error(`扣子运行工作流超时（${timeoutMs}ms）`)
    throw e
  }
  const json = await parseCozeEnvelope(res, '运行工作流')
  return { raw: json.data }
}

export async function cozeUploadFile(
  buf: Buffer,
  filename: string,
  opts?: { fetchImpl?: CozeFetch; timeoutMs?: number },
): Promise<{ fileId: string }> {
  const { baseUrl, apiKey } = await getCozeCfg()
  const fetchImpl = opts?.fetchImpl ?? fetch
  const timeoutMs = opts?.timeoutMs ?? 60_000
  const form = new FormData()
  // Buffer 的类型形参是 ArrayBufferLike（可能是 SharedArrayBuffer），BlobPart 只收 ArrayBuffer，
  // 用 Uint8Array 包一层规避类型不兼容——运行时字节内容不变
  form.append('file', new Blob([new Uint8Array(buf)]), filename)
  let res: Response
  try {
    res = await fetchImpl(`${baseUrl}/v1/files/upload`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch (e) {
    if (isAbortLike(e)) throw new Error(`扣子上传文件超时（${timeoutMs}ms）`)
    throw e
  }
  const json = await parseCozeEnvelope(res, '上传文件')
  const data = json.data as Record<string, unknown> | undefined
  const fileId = data?.id ?? data?.file_id
  if (typeof fileId !== 'string' || !fileId) {
    throw new Error(`扣子上传文件返回格式异常: ${JSON.stringify(json).slice(0, 200)}`)
  }
  return { fileId }
}

export async function cozeFetchWorkflowParams(
  workflowId: string,
  opts?: { fetchImpl?: CozeFetch; timeoutMs?: number },
): Promise<{ name: string; type?: string; required?: boolean }[] | null> {
  const { baseUrl, apiKey } = await getCozeCfg()
  const fetchImpl = opts?.fetchImpl ?? fetch
  const timeoutMs = opts?.timeoutMs ?? 60_000
  let res: Response
  try {
    res = await fetchImpl(`${baseUrl}/v1/workflows/${workflowId}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch (e) {
    if (isAbortLike(e)) throw new Error(`扣子拉取工作流参数超时（${timeoutMs}ms）`)
    throw e // 网络错误：多半是 baseUrl 配错，是配置问题，要让运营看见，不能悄悄吞掉
  }

  // 404/工作流不存在：预期路径（该端点可能不被这个扣子版本支持，或工作流 id 尚未发布），
  // 交回调用方走手动兜底，不当成异常
  if (res.status === 404) return null

  const text = await res.text().catch(() => '')
  if (res.status === 401) {
    throw new Error(`扣子鉴权失败（Token 无效或无权限）: ${text.slice(0, 200)}`)
  }
  if (!res.ok) return null // 其它非成功状态也按"拿不到参数列表"处理，走手动兜底

  let json: CozeEnvelope
  try { json = JSON.parse(text) } catch { return null } // 解析不出 → 手动兜底

  const code = typeof json.code === 'number' ? json.code : 0
  if (code === 401) throw new Error(`扣子鉴权失败（Token 无效或无权限）: ${String(json.msg ?? '')}`)
  if (code !== 0) return null // 接口不存在等业务错误 → 手动兜底

  const list = (json.data as Record<string, unknown> | undefined)?.parameters
  if (!Array.isArray(list)) return null

  const params = list
    .map((p): { name: string; type?: string; required?: boolean } | null => {
      if (!p || typeof p !== 'object') return null
      const name = (p as Record<string, unknown>).name
      if (typeof name !== 'string' || !name) return null
      const type = (p as Record<string, unknown>).type
      const required = (p as Record<string, unknown>).required
      return {
        name,
        ...(typeof type === 'string' ? { type } : {}),
        ...(typeof required === 'boolean' ? { required } : {}),
      }
    })
    .filter((p): p is { name: string; type?: string; required?: boolean } => p !== null)

  return params.length > 0 ? params : null
}
