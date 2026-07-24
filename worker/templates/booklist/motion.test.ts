import { describe, it, expect } from 'vitest'
import { MOVES, pickMove, moveTweens, beatAccent } from './motion'

describe('pickMove', () => {
  it('确定性、相邻 seqNo 不撞招', () => {
    expect(pickMove(1, 0)).toBe(pickMove(1, 0))
    expect(pickMove(1, 0)).not.toBe(pickMove(2, 0))
  })
  it('offset 移动轮换相位', () => {
    expect(pickMove(1, 0)).not.toBe(pickMove(1, 1))
  })
})

describe('moveTweens', () => {
  it('针对 .sN .photo，位置=startMs 秒，无 function-based 值', () => {
    const out = moveTweens('push-in', 2, 2000, 4500, false)
    expect(out).toContain(".s2 .photo'")
    expect(out).toContain(', 2)') // 起点秒
    expect(out).not.toContain('function')
    expect(out).not.toContain('=>')
  })
  it('末段 push-in 目标幅度更大(1.16)', () => {
    expect(moveTweens('push-in', 3, 4000, 6000, true)).toContain('scale: 1.16')
    expect(moveTweens('push-in', 1, 0, 2000, false)).toContain('scale: 1.105')
  })
  it('每种招式都能产出针对 .photo 的 tween', () => {
    for (const m of MOVES) {
      const out = moveTweens(m, 1, 0, 2000, false)
      expect(out).toContain(".s1 .photo'")
      expect(out).toContain('duration:')
    }
  })
})

describe('beatAccent', () => {
  it('在给定秒处对 .sN .photo 叠短脉冲', () => {
    const out = beatAccent(2, 2000)
    expect(out).toContain(".s2 .photo'")
    expect(out).toContain(', 2)')
    expect(out).toContain('duration: 0.12')
  })
})
