import { describe, it, expect } from 'vitest'
import { fitToSegmentCount } from './fitSegments'

describe('fitToSegmentCount', () => {
  // 复刻线上那条真实数据：LLM 给 5 段、槽位 4 段。
  // 尾部合并会让最后一段变成 7+27=34 字（对着 6068ms 的槽位，实测超 92%）；
  // 合并最短相邻一对后最长段是 27 字，落在该槽位的配额内。
  it('线上实测场景：合并后最长段明显更短', () => {
    const lines = [
      '如果你总困在过往的遗憾里', '内耗与执念反复拉扯', '那么你永远没办法好好拥抱当下',
      '安稳温柔的生活', '自愈的路上没有人能替你抚平情绪，也没有人能帮你放下心结',
    ]
    const out = fitToSegmentCount(lines, 4)
    expect(out).toHaveLength(4)
    const maxLen = Math.max(...out.map((l) => Array.from(l).length))
    // 尾部合并会得到 34（7+27）；合并最短相邻一对得到 27
    expect(maxLen, `最长段 ${maxLen} 字，尾部合并会是 34`).toBeLessThan(30)
    // 内容不能丢：合并只是拼接，总字数必须守恒
    expect(out.join('').length).toBe(lines.join('').length)
  })

  it('恰好相等 → 原样返回', () => {
    const lines = ['甲', '乙', '丙']
    expect(fitToSegmentCount(lines, 3)).toEqual(lines)
  })

  // ★ 改自「无条件往尾部合并」。线上实测踩了坑：LLM 返回 5 段、槽位 4 段，
  // 合并后最后一段拿到两段文案，配音 11640ms 对着 6068ms 的槽位——超 92%，
  // 成片从 24.6 秒涨到 29.4 秒。合并发生在**字数配额之后**，尾部合并等于把配额作废。
  it('多了 → 合并最短的相邻一对（把合并后的最长段压到最小）', () => {
    // 等长时取最靠前的一对，结果稳定可预期
    expect(fitToSegmentCount(['一', '二', '三', '四', '五'], 3)).toEqual(['一二', '三四', '五'])
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
