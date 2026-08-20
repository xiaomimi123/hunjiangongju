import { describe, it, expect } from 'vitest'
import { fitToSegmentCount } from './fitSegments'

describe('fitToSegmentCount', () => {
  it('恰好相等 → 原样返回', () => {
    const lines = ['甲', '乙', '丙']
    expect(fitToSegmentCount(lines, 3)).toEqual(lines)
  })

  it('多了 → 从尾部合并相邻两段（尾部是收束句，合并损失最小）', () => {
    expect(fitToSegmentCount(['一', '二', '三', '四', '五'], 3)).toEqual(['一', '二', '三四五'])
  })

  it('多很多 → 合并到恰好 N 段，不丢内容', () => {
    const out = fitToSegmentCount(['a', 'b', 'c', 'd', 'e', 'f', 'g'], 2)
    expect(out).toHaveLength(2)
    expect(out.join('')).toBe('abcdefg')
  })

  it('少了 → 切最长的一段，在最靠近中点的标点处断开', () => {
    const out = fitToSegmentCount(['短句', '这是一个很长的句子，需要被切开，因为槽位不够'], 3)
    expect(out).toHaveLength(3)
    expect(out.join('')).toContain('这是一个很长的句子')
  })

  it('少了但没有标点可切 → 按字数中点硬切，仍凑够 N 段', () => {
    const out = fitToSegmentCount(['短', '一二三四五六七八九十'], 3)
    expect(out).toHaveLength(3)
    expect(out.every((x) => x.length > 0)).toBe(true)
  })

  it('无论多少输入,输出都恰好 N 段且不丢字', () => {
    for (const n of [1, 2, 3, 5, 8]) {
      const out = fitToSegmentCount(['甲乙丙', '丁戊', '己庚辛壬', '癸'], n)
      expect(out).toHaveLength(n)
      expect(out.join('').replace(/[，。]/g, '')).toBe('甲乙丙丁戊己庚辛壬癸')
    }
  })

  it('目标为 0 或负 → 原样返回，不抛错', () => {
    expect(fitToSegmentCount(['甲', '乙'], 0)).toEqual(['甲', '乙'])
    expect(fitToSegmentCount(['甲', '乙'], -1)).toEqual(['甲', '乙'])
  })

  it('空输入 → 空数组', () => {
    expect(fitToSegmentCount([], 3)).toEqual([])
  })

  it('单段要切成多段时不产生空段', () => {
    const out = fitToSegmentCount(['一二三四五六'], 3)
    expect(out).toHaveLength(3)
    expect(out.every((x) => x.trim().length > 0)).toBe(true)
  })
})
