// 限并发地并行执行。
//
// 为什么需要：出片链路里最重的一步是生图，而生图是**纯网络等待、不吃 CPU**。
// 线上实测一条片子 9 分 52 秒，其中书封 8 张串行跑掉 422 秒（52.8s/张）——占全片 71%。
// 这 8 次调用之间毫无依赖，串行纯属浪费。
//
// 但也不能全量并发：百炼有 QPS 限制，一次打太多会 429，重试反而更慢。
// 限并发是「快」与「被限流」之间的那个平衡点。

/**
 * 对 items 并行执行 fn，同时最多 limit 个在跑。结果按**原顺序**返回。
 *
 * 顺序很重要：书封文件名是 01/02/03…，与书目顺序一一对应，
 * 乱序会让《活着》的封面配到别的书上。
 */
export async function mapLimited<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const n = items.length
  if (n === 0) return []
  const out = new Array<R>(n)
  const width = Math.max(1, Math.min(Math.floor(limit) || 1, n))
  let next = 0
  const runner = async () => {
    for (;;) {
      const i = next++
      if (i >= n) return
      out[i] = await fn(items[i], i)
    }
  }
  // 任一个抛错就整体抛出（Promise.all 语义）：调用方需要知道有图没生成出来，
  // 而不是拿到一个残缺的数组继续往下走
  await Promise.all(Array.from({ length: width }, runner))
  return out
}
