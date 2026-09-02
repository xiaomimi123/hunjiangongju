// 扣子(Coze) 工作流参数自动探测：工作流详情接口只有元数据、没有参数 schema
// （见 cozeFetchWorkflowParams 的注释），本文件用「故意跑一次流式运行，
// 靠扣子的参数校验报错反推参数表」的笨办法补上这个缺口。
//
// 循环逻辑（实测行为，2026-09-03 spike，真实调用 coze.cn API 得到）：
//   POST {baseUrl}/v1/workflow/stream_run，body { workflow_id, parameters }
//   响应是 SSE 文本，只看首个事件（按 \n\n 分段，事件内多条 data: 续行拼接后）的 JSON：
//     - error_message 以 "Missing parameter: " 开头
//       → 记该字段为 { type:'text', required:true }，参数表里补上 "探测" 继续下一轮；
//         若这个字段名已经探到过（同名重复缺失，说明探测没有进展，再跑下去也是空转）
//         → 直接收敛，started=false，error 里说明是哪个字段反复缺失
//     - error_message 含 "can't convert to file"
//       → 上一轮刚补的字段（fields 里最后一个）改判为 { type:'image' }，
//         参数值换成 JSON.stringify({file_id:'0'})（file_id 是否有效不重要，
//         类型校验发生在文件下载之前）继续下一轮；
//         若此时 fields 是空的（没有「上一轮补的字段」可改），说明拿不到这条报错
//         对应哪个参数名 → 直接收敛，started=false，error 里说明无法定位
//     - 其它情形（无 error_message，或 error_message 不匹配上面两种模式）
//       → 参数校验已经全过，工作流真的启动了：收敛，started=true
//   HTTP 非 2xx 且不是鉴权失败（例如网关 502 返回一坨 HTML）
//       → 直接抛中文错误，不当成「无 error_message」误判为已收敛
//   鉴权失败（HTTP 401，或响应体 code 属于 4100/4101，或 error_message 含 authentication）
//       → 直接抛中文错误，不重试、不计入轮数
//   跑满 maxRounds（默认 12）仍未收敛
//       → 返回已探到的字段，started=false（不是错误，调用方按“探测不完整”处理）
//   非 Missing/非 file 转换错误（工作流未发布、workflow_id 不存在等）
//       → 收敛，started=false，把错误文本放进返回值 error 字段供管理页展示
//
// 多余的参数扣子会静默忽略、不报错；选填参数天生探不出来（不缺就不报错），
// 这是本方法的已知局限，不是 bug。

import { getCapabilityConfig } from './config'

export type CozeFetch = typeof fetch

export type CozeProbedField = { name: string; type: 'text' | 'image'; required: true }

export type CozeProbeResult = {
  fields: CozeProbedField[]
  started: boolean
  error?: string
}

async function getCozeCfg(): Promise<{ baseUrl: string; apiKey: string }> {
  const cfg = await getCapabilityConfig('coze')
  if (!cfg.enabled || !cfg.baseUrl || !cfg.apiKey) {
    throw new Error('扣子未配置，请在模型配置里填 Token')
  }
  return { baseUrl: cfg.baseUrl.replace(/\/+$/, ''), apiKey: cfg.apiKey }
}

function isAbortLike(e: unknown): boolean {
  const name = (e as { name?: unknown } | null)?.name
  return name === 'TimeoutError' || name === 'AbortError'
}

// 从 SSE 文本里取首个事件的 JSON。SSE 规范里一个事件用空行（\n\n）分隔，事件内允许
// 出现多条 data: 续行、拼接后才是完整 payload（本项目实测扣子只发单行，但按规范兜底）。
// 返回 null 有两种不同原因，调用方靠“event 里有没有 error_message”区分：
//   1) 整段文本压根没有任何 data: 行（空流/非 SSE 格式）——上层当作“无 error_message”，
//      即校验已过、工作流已启动；
//   2) data: 行拼出来的 payload 不是合法 JSON——同样退化为“无 error_message”处理，
//      这里不做二次区分是因为两种情况对调用方的处理路径完全一样。
function parseFirstSseData(text: string): Record<string, unknown> | null {
  const firstEvent = text.split(/\n\n/)[0] ?? ''
  const dataLines: string[] = []
  for (const line of firstEvent.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed.startsWith('data:')) continue
    dataLines.push(trimmed.slice('data:'.length).trim())
  }
  if (dataLines.length === 0) return null
  const payload = dataLines.join('')
  try {
    const json = JSON.parse(payload)
    return json && typeof json === 'object' ? (json as Record<string, unknown>) : null
  } catch {
    return null
  }
}

function isAuthError(status: number, event: Record<string, unknown> | null): boolean {
  if (status === 401) return true
  const code = event?.error_code
  const codeStr = typeof code === 'number' ? String(code) : typeof code === 'string' ? code : ''
  if (codeStr === '4100' || codeStr === '4101') return true
  const msg = event?.error_message
  if (typeof msg === 'string' && /authentication/i.test(msg)) return true
  return false
}

export async function cozeProbeWorkflowParams(
  workflowId: string,
  opts?: { fetchImpl?: CozeFetch; maxRounds?: number; overallTimeoutMs?: number },
): Promise<CozeProbeResult> {
  const { baseUrl, apiKey } = await getCozeCfg()
  const fetchImpl = opts?.fetchImpl ?? fetch
  const maxRounds = opts?.maxRounds ?? 12
  // 整体探测 deadline：单次探测要跑多轮 stream_run，某些工作流参数多、轮数多，
  // 单轮超时（60s）挡不住总耗时失控。超过 deadline 就把已探到的字段先收敛返回，
  // 比让管理页一直转圈更诚实。
  const overallTimeoutMs = opts?.overallTimeoutMs ?? 90_000
  const deadline = Date.now() + overallTimeoutMs
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` }
  const url = `${baseUrl}/v1/workflow/stream_run`

  const fields: CozeProbedField[] = []
  const seenNames = new Set<string>()
  const parameters: Record<string, unknown> = {}

  for (let round = 0; round < maxRounds; round++) {
    if (Date.now() >= deadline) {
      return { fields, started: false, error: `探测超时，已探到 ${fields.length} 个字段` }
    }
    let res: Response
    let text: string
    try {
      res = await fetchImpl(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({ workflow_id: workflowId, parameters }),
        signal: AbortSignal.timeout(60_000),
      })
      text = await res.text()
    } catch (e) {
      if (isAbortLike(e)) throw new Error('扣子探测参数超时（60000ms）')
      throw e
    }

    const event = parseFirstSseData(text)

    if (isAuthError(res.status, event)) {
      const msg = typeof event?.error_message === 'string' ? event.error_message : text.slice(0, 200)
      throw new Error(`扣子鉴权失败（Token 无效或无权限）: ${msg}`)
    }

    // HTTP 非 2xx 且不是鉴权失败：例如网关 502 返回一坨 HTML，text 里自然拿不到
    // error_message，若不在这里拦截会被后面的“无 error_message”分支误判为已收敛启动
    if (!res.ok) {
      throw new Error(`扣子探测参数请求失败 ${res.status}: ${text.slice(0, 300)}`)
    }

    const errorMessage = typeof event?.error_message === 'string' ? event.error_message : undefined

    if (errorMessage && errorMessage.startsWith('Missing parameter: ')) {
      const name = errorMessage.slice('Missing parameter: '.length).trim()
      if (seenNames.has(name)) {
        // 同一个字段名反复被判缺失：探测没有进展，再跑下去只是空转到 maxRounds，
        // 直接收敛并说明原因，比装作“还在探测”更诚实
        return { fields, started: false, error: `字段 ${name} 反复缺失，无法收敛` }
      }
      seenNames.add(name)
      fields.push({ name, type: 'text', required: true })
      parameters[name] = '探测'
      continue
    }

    if (errorMessage && errorMessage.includes("can't convert to file")) {
      const last = fields[fields.length - 1]
      if (!last) {
        // 拿到“转文件失败”的报错，但 fields 里还没有任何已探到的字段可以归因
        // （理论上不该发生——这条报错本该跟在某次 Missing parameter 之后），
        // 强行猜一个字段名可能张冠李戴，不如诚实收敛
        return { fields, started: false, error: '收到文件类型转换报错，但无法定位对应的参数字段' }
      }
      if (last.type === 'image') {
        // 同一个字段已经被改判成 image、换过 file_id 占位值了，还是报同样的转换错误：
        // 再改也没有别的类型可试，继续跑下去只是空转到 maxRounds，直接收敛
        return { fields, started: false, error: `字段 ${last.name} 类型探测无法收敛` }
      }
      last.type = 'image'
      parameters[last.name] = JSON.stringify({ file_id: '0' })
      continue
    }

    if (errorMessage) {
      // 非 Missing/非 file 转换错误：工作流未发布、workflow_id 不存在等，收敛但未真正启动
      return { fields, started: false, error: errorMessage }
    }

    // 无 error_message：参数校验全过，工作流已真实启动
    return { fields, started: true }
  }

  // 跑满轮数仍未收敛
  return { fields, started: false }
}
