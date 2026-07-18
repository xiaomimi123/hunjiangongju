import { describe, it, expect } from 'vitest'
import { withRetry } from './retry'

describe('withRetry', () => {
  it('前几次失败后成功则返回结果', async () => {
    let n = 0
    const r = await withRetry(async () => {
      n++
      if (n < 3) throw new Error('瞬时错误')
      return 'ok'
    }, { attempts: 3, delayMs: 0 })
    expect(r).toBe('ok')
    expect(n).toBe(3)
  })

  it('全部失败则抛最后一个错误', async () => {
    let n = 0
    await expect(
      withRetry(async () => { n++; throw new Error(`fail${n}`) }, { attempts: 2, delayMs: 0 }),
    ).rejects.toThrow('fail2')
    expect(n).toBe(2)
  })

  it('首次成功不重试', async () => {
    let n = 0
    const r = await withRetry(async () => { n++; return 42 }, { attempts: 3, delayMs: 0 })
    expect(r).toBe(42)
    expect(n).toBe(1)
  })
})
