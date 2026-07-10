import { HttpError } from './auth'

const hits = new Map<string, number[]>()

// 同 key 在 windowMs 内超过 limit 次即抛 429。进程内存态——单实例 MVP 足够，多实例需换 Redis。
export function checkRate(bucket: string, key: string, limit: number, windowMs = 60_000): void {
  const k = `${bucket}:${key}`
  const now = Date.now()
  const arr = (hits.get(k) ?? []).filter((t) => now - t < windowMs)
  if (arr.length >= limit) throw new HttpError(429, '操作过于频繁，请稍后再试')
  arr.push(now)
  hits.set(k, arr)
  if (hits.size > 5000) { for (const [k2, v] of Array.from(hits.entries())) if (v.every((t) => now - t >= windowMs)) hits.delete(k2) }
}
