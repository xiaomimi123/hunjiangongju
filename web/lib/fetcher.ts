// 带机器可读错误码的请求错误：后端 HttpError 的 code 原样透传（如 NO_CREDITS），
// 前端据此走专门 UI（弹充值二维码等）；没有 code 的错误只有人读文案。
export class ApiError extends Error {
  constructor(message: string, public code?: string) {
    super(message)
  }
}

export async function api<T>(
  path: string,
  opts: { method?: string; body?: unknown; form?: FormData } = {}
): Promise<T> {
  const res = await fetch(path, {
    method: opts.method ?? (opts.body || opts.form ? 'POST' : 'GET'),
    headers: opts.body ? { 'Content-Type': 'application/json' } : undefined,
    body: opts.form ?? (opts.body ? JSON.stringify(opts.body) : undefined),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    const d = data as { error?: string; code?: string }
    throw new ApiError(d.error ?? `请求失败(${res.status})`, d.code)
  }
  return data as T
}
