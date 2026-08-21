import { describe, it, expect } from 'vitest'
import { mapLimited } from './mapLimited'

// ★ 线上实测:一条片子 9 分 52 秒,其中书封 8 张串行跑掉 422 秒(52.8s/张)——占 71%。
// 这些调用之间毫无依赖,纯粹是等网络,串行是浪费。
describe('mapLimited', () => {
  it('结果按原顺序返回', async () => {
    // 故意让后面的先完成,验证顺序不是靠完成时间决定的
    const r = await mapLimited([30, 20, 10, 0], 4, async (ms, i) => {
      await new Promise((res) => setTimeout(res, ms))
      return i
    })
    expect(r, '顺序乱了会让《活着》的封面配到别的书上').toEqual([0, 1, 2, 3])
  })

  it('同时最多 limit 个在跑', async () => {
    let now = 0
    let peak = 0
    await mapLimited(Array.from({ length: 12 }), 4, async () => {
      now++; peak = Math.max(peak, now)
      await new Promise((r) => setTimeout(r, 10))
      now--
      return null
    })
    expect(peak, `同时跑了 ${peak} 个`).toBeLessThanOrEqual(4)
  })

  it('确实是并行：12 个任务、并发 4，用时应远小于串行', async () => {
    const t0 = Date.now()
    await mapLimited(Array.from({ length: 12 }), 4, async () => {
      await new Promise((r) => setTimeout(r, 30))
      return null
    })
    const ms = Date.now() - t0
    // 串行是 360ms；并发 4 理论 90ms。给足余量取 200ms
    expect(ms, `用时 ${ms}ms，看起来还是串行`).toBeLessThan(200)
  })

  // 有图没生成出来必须让调用方知道,不能拿着残缺数组往下走
  it('任一失败则整体抛出', async () => {
    await expect(
      mapLimited([1, 2, 3], 2, async (x) => { if (x === 2) throw new Error('生图失败'); return x }),
    ).rejects.toThrow('生图失败')
  })

  it('空数组与 limit 非法都不炸', async () => {
    expect(await mapLimited([], 4, async () => 1)).toEqual([])
    expect(await mapLimited([1, 2], 0, async (x) => x)).toEqual([1, 2])
    expect(await mapLimited([1, 2], 99, async (x) => x)).toEqual([1, 2])
  })
})
