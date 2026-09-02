// 扣子(Coze) 工作流参数自动探测：工作流详情接口只有元数据、没有参数 schema
// （见 cozeFetchWorkflowParams 的注释），本文件用「故意跑一次流式运行，
// 靠扣子的参数校验报错反推参数表」的笨办法补上这个缺口。
//
// 循环逻辑（实测行为，2026-09-03 spike，真实调用 coze.cn API 得到）：
//   POST {baseUrl}/v1/workflow/stream_run，body { workflow_id, parameters }
//   响应是 SSE 文本，只看首个 `data: {...}` 行的 JSON：
//     - error_message 以 "Missing parameter: " 开头
//       → 记该字段为 { type:'text', required:true }，参数表里补上 "探测" 继续下一轮
//     - error_message 含 "can't convert to file"
//       → 上一轮刚探到的字段（必是最后一个）改判为 { type:'image' }，
//         参数值换成 JSON.stringify({file_id:'0'})（file_id 是否有效不重要，
//         类型校验发生在文件下载之前）继续下一轮
//     - 其它情形（无 error_message，或 error_message 不匹配上面两种模式）
//       → 参数校验已经全过，工作流真的启动了：收敛，started=true
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

// 从 SSE 文本里取首个 `data: ` 行的 JSON。取不到（例如空流、格式异常）返回 null，
// 按“无 error_message”处理——收敛为已启动，因为这本来就代表校验没有再报错。
function parseFirstSseData(text: string): Record<string, unknown> | null {
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed.startsWith('data:')) continue
    const payload = trimmed.slice('data:'.length).trim()
    if (!payload) continue
    try {
      const json = JSON.parse(payload)
      return json && typeof json === 'object' ? (json as Record<string, unknown>) : null
    } catch {
      return null
    }
  }
  return null
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
  opts?: { fetchImpl?: CozeFetch; maxRounds?: number },
): Promise<CozeProbeResult> {
  const { baseUrl, apiKey } = await getCozeCfg()
  const fetchImpl = opts?.fetchImpl ?? fetch
  const maxRounds = opts?.maxRounds ?? 12
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` }
  const url = `${baseUrl}/v1/workflow/stream_run`

  const fields: CozeProbedField[] = []
  const parameters: Record<string, unknown> = {}

  for (let round = 0; round < maxRounds; round++) {
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

    const errorMessage = typeof event?.error_message === 'string' ? event.error_message : undefined

    if (errorMessage && errorMessage.startsWith('Missing parameter: ')) {
      const name = errorMessage.slice('Missing parameter: '.length).trim()
      fields.push({ name, type: 'text', required: true })
      parameters[name] = '探测'
      continue
    }

    if (errorMessage && errorMessage.includes("can't convert to file")) {
      const last = fields[fields.length - 1]
      if (last) {
        last.type = 'image'
        parameters[last.name] = JSON.stringify({ file_id: '0' })
      }
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
