// DashScope 异步任务（录音文件识别 Paraformer / qwen3-asr-flash-filetrans 共用）：
// 提交任务需带 header `X-DashScope-Async: enable`，返回 output.task_id；
// 轮询 `GET {origin}/api/v1/tasks/{task_id}`，output.task_status 为 SUCCEEDED/FAILED/其他(继续轮询)。
// 核对自 https://help.aliyun.com/zh/model-studio/paraformer-recorded-speech-recognition-restful-api

// 与 dashscope.ts 的 dashGenEndpoint 同策略：从用户配置的 baseUrl 取 origin 拼接原生端点路径，
// 而非写死 dashscope.aliyuncs.com —— 百炼北京地域文档推荐迁移至按 workspace 区分的域名。
function resolveOrigin(baseUrl: string): string {
  try { return new URL(baseUrl).origin } catch { return 'https://dashscope.aliyuncs.com' }
}

export async function dashAsyncSubmit(baseUrl: string, apiKey: string, path: string, body: unknown): Promise<string> {
  const url = `${resolveOrigin(baseUrl)}${path}`
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
      'X-DashScope-Async': 'enable',
    },
    body: JSON.stringify(body),
  })
  const text = await res.text().catch(() => '')
  let j: any
  try { j = text ? JSON.parse(text) : {} } catch { throw new Error(`ASR 提交返回非 JSON: ${text.slice(0, 200)}`) }
  const taskId = j?.output?.task_id
  if (!res.ok || !taskId) throw new Error(`ASR 提交失败 ${res.status}: ${text.slice(0, 300)}`)
  return taskId
}

export async function dashAsyncPoll(
  baseUrl: string,
  apiKey: string,
  taskId: string,
  o: { intervalMs: number; timeoutMs: number } = { intervalMs: 3000, timeoutMs: 600000 },
): Promise<any> {
  const origin = resolveOrigin(baseUrl)
  const started = Date.now()
  // 轮询用固定间隔；Date.now/setTimeout 仅在 worker（非 workflow 脚本）里直接用是安全的
  while (Date.now() - started < o.timeoutMs) {
    const res = await fetch(`${origin}/api/v1/tasks/${taskId}`, { headers: { Authorization: `Bearer ${apiKey}` } })
    const text = await res.text().catch(() => '')
    let j: any
    try { j = text ? JSON.parse(text) : {} } catch { j = {} }
    const st = j?.output?.task_status
    if (st === 'SUCCEEDED') return j.output
    if (st === 'FAILED') throw new Error(`ASR 任务失败: ${text.slice(0, 300)}`)
    await new Promise((r) => setTimeout(r, o.intervalMs))
  }
  throw new Error('ASR 轮询超时')
}
