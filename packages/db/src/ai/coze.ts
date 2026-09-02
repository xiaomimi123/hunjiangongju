// 扣子(Coze) API 客户端：运行工作流 / 上传文件 / 拉取工作流参数定义。
//
// 形状已经真实 API spike 验证（2026-09-03，coze.cn）：
//   - 运行必须走异步：POST /v1/workflow/run + is_async:true → 顶层 execute_id，
//     再轮询 GET /v1/workflows/{workflow_id}/run_histories/{execute_id}。
//     同步 run 对慢工作流（视频类，>10 分钟）零字节挂到超时，不可用。
//   - 轮询响应可能是**非法 JSON**（扣子已知 bug：data[0].output 里双重序列化的
//     node_status 转义写错，\\" 该写成 \\\"），所以状态提取先 JSON.parse、
//     失败退化为正则，绝不因解析失败把一次正常运行判死。
//   - 文件上传返回 data.id；工作流详情接口只有元数据没有参数 schema（手动兜底是正解）。
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

// run_histories 单条的解析结果。status 取值实测为 Running / Success / Fail。
type RunHistory = { status: string; output?: string; errorMsg?: string }

// 宽松反转义：把一层 JSON 字符串转义还原成字符。用于扣子返回非法 JSON 时的
// 正则兜底路径——单趟扫描，每个 `\X` 只被替换一次，不会出现「先替换出的字符又被
// 后续规则二次替换」的错序问题（例如分步替换时 \\\\ 会被前面的 \\" 规则误吃半截）。
// 对扣子的错误转义（\\" 实际当引号用）也能得到可读文本。best-effort，不保证可 JSON.parse。
function looseUnescape(s: string): string {
  return s.replace(/\\(u[0-9a-fA-F]{4}|.)/g, (_, g: string) => {
    if (g[0] === 'u') return String.fromCharCode(parseInt(g.slice(1), 16))
    switch (g) {
      case 'n': return '\n'
      case 't': return '\t'
      case 'r': return '\r'
      case '"': return '"'
      case '\\': return '\\'
      default: return g // 未知转义：原样保留转义后的字符，不猜
    }
  })
}

// 解析 run_histories 响应文本。先按合法 JSON 走；失败（扣子转义 bug）退化为正则提取。
// 返回 null 表示连状态都提不出来（当作一次失败的轮询，继续重试直到总超时）。
export function parseRunHistoryText(text: string): RunHistory | null {
  try {
    const json = JSON.parse(text) as { data?: unknown }
    const item = Array.isArray(json.data) ? (json.data[0] as Record<string, unknown> | undefined) : undefined
    if (item && typeof item.execute_status === 'string') {
      const parts = [item.error_code, item.error_message].filter((x): x is string => typeof x === 'string' && x.length > 0)
      return {
        status: item.execute_status,
        ...(typeof item.output === 'string' ? { output: item.output } : {}),
        ...(parts.length ? { errorMsg: parts.join(' ') } : {}),
      }
    }
  } catch { /* 非法 JSON：走正则兜底 */ }
  const st = /"execute_status"\s*:\s*"([A-Za-z]+)"/.exec(text)
  if (!st) return null
  // 终结符：裸引号+逗号+下一个 ASCII 键名。output 内部被错误转义的引号前面都带反斜杠、
  // 键名多为中文（输出_N），不会误匹配；实测 Fail 响应里 output 后面跟的是 "usage"。
  const om = /"output"\s*:\s*"([\s\S]*?)"\s*,\s*"[A-Za-z_]+"\s*:/.exec(text)
  const em = /"error_message"\s*:\s*"([\s\S]*?)"\s*,\s*"[A-Za-z_]+"\s*:/.exec(text)
  return {
    status: st[1],
    ...(om ? { output: looseUnescape(om[1]) } : {}),
    ...(em ? { errorMsg: looseUnescape(em[1]) } : {}),
  }
}

export async function cozeRunWorkflow(
  workflowId: string,
  parameters: Record<string, unknown>,
  opts?: { fetchImpl?: CozeFetch; timeoutMs?: number; pollIntervalMs?: number },
): Promise<{ raw: unknown }> {
  const { baseUrl, apiKey } = await getCozeCfg()
  const fetchImpl = opts?.fetchImpl ?? fetch
  const timeoutMs = opts?.timeoutMs ?? 30 * 60_000 // 视频类工作流实测可超 10 分钟，总预算 30 分钟
  const pollIntervalMs = opts?.pollIntervalMs ?? 10_000
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` }

  // ── 异步提交 ──
  let res: Response
  try {
    res = await fetchImpl(`${baseUrl}/v1/workflow/run`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ workflow_id: workflowId, parameters, is_async: true }),
      signal: AbortSignal.timeout(60_000),
    })
  } catch (e) {
    if (isAbortLike(e)) throw new Error('扣子提交工作流超时（60000ms）')
    throw e
  }
  const json = await parseCozeEnvelope(res, '运行工作流')
  // execute_id 实测在响应**顶层**（不在 data 里）
  const executeId = (json as { execute_id?: unknown }).execute_id
  if (typeof executeId !== 'string' || !executeId) {
    throw new Error(`扣子未返回 execute_id: ${JSON.stringify(json).slice(0, 200)}`)
  }

  // ── 轮询直到终态或总超时 ──
  const deadline = Date.now() + timeoutMs
  const historyUrl = `${baseUrl}/v1/workflows/${workflowId}/run_histories/${executeId}`
  while (true) {
    if (Date.now() >= deadline) throw new Error(`扣子运行工作流超时（${timeoutMs}ms）`)
    let text = ''
    let httpStatus = 0
    try {
      const r = await fetchImpl(historyUrl, { headers: { Authorization: `Bearer ${apiKey}` }, signal: AbortSignal.timeout(30_000) })
      httpStatus = r.status
      text = await r.text()
    } catch { /* 单次网络失败：吞掉，靠总超时兜底 */ }
    // 鉴权失败没有重试的意义（Token 失效/权限被收回），立刻报出去
    if (httpStatus === 401 || /"code"\s*:\s*410[01]\b/.test(text)) {
      throw new Error(`扣子鉴权失败（Token 无效或无权限）: ${text.slice(0, 200)}`)
    }
    const h = text ? parseRunHistoryText(text) : null
    // 终态判断改白名单：只认扣子实测出现过的两个终态字面量（Success/Fail）。
    // 其余任何状态——包括 Running、Queued 等已知中间态，以及未来可能出现的未知状态——
    // 都继续轮询，靠外层总超时兜底，不因为看到一个陌生字符串就误判成功/失败。
    if (h && h.status === 'Success') {
      // Success 但 output 为空/undefined：说明这次轮询响应本身有问题（扣子服务端异常
      // 返回了空壳成功），不能把「空结果」当正常输出返回给上层——上层会据此判定运行成功
      // 并落库展示，学员会既被扣分又拿到空结果。这里直接抛错，让 worker 走 failRun 退分。
      if (!h.output) throw new Error('扣子返回成功但未取到输出内容')
      return { raw: h.output }
    }
    if (h && h.status === 'Fail') {
      throw new Error(`扣子工作流运行失败（${h.status}）: ${(h.errorMsg ?? h.output ?? '').slice(0, 300) || '无错误详情'}`)
    }
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs))
  }
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
