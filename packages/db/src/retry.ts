// 通用异步重试：真实 AI 调用（文生图/合成等）偶发超时/瞬时错误时，重试而非整任务失败。
export async function withRetry<T>(
  fn: (attempt: number) => Promise<T>,
  opts: { attempts?: number; delayMs?: number; onRetry?: (err: unknown, attempt: number) => void } = {},
): Promise<T> {
  const attempts = Math.max(1, opts.attempts ?? 3)
  const delayMs = opts.delayMs ?? 2000
  let lastErr: unknown
  for (let i = 1; i <= attempts; i++) {
    try {
      return await fn(i)
    } catch (err) {
      lastErr = err
      if (i < attempts) {
        opts.onRetry?.(err, i)
        if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs))
      }
    }
  }
  throw lastErr
}
