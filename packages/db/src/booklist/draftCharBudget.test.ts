import { describe, it, expect } from 'vitest'
import { deriveDraftCharBudget, deriveDraftSpeechRate } from './draftCharBudget'

describe('deriveDraftSpeechRate', () => {
  it('按正文文字层的总字数/总时长算实测语速', () => {
    // 11 字 / 2000ms + 9 字 / 2000ms = 20 字 / 4s = 5 字/秒
    const r = deriveDraftSpeechRate([
      { text: '如果你总困在过往的遗憾', durationMs: 2000 },   // 11 字
      { text: '内耗与执念里反复拉扯', durationMs: 2000 },      // 10 字
    ])
    expect(r).toBeCloseTo(21 / 4, 1)
  })

  it('样本不足/时长为零 → null(调用方回退通用常数)', () => {
    expect(deriveDraftSpeechRate([])).toBeNull()
    expect(deriveDraftSpeechRate([{ text: '甲', durationMs: 0 }])).toBeNull()
    expect(deriveDraftSpeechRate([{ text: '', durationMs: 1000 }])).toBeNull()
  })

  it('语速离谱(过快/过慢)→ null,不让脏数据污染预算', () => {
    expect(deriveDraftSpeechRate([{ text: '甲', durationMs: 60000 }])).toBeNull()      // 0.02 字/秒
    expect(deriveDraftSpeechRate([{ text: '一二三四五六七八九十', durationMs: 200 }])).toBeNull() // 50 字/秒
  })
})

describe('deriveDraftCharBudget', () => {
  it('按正片时长×语速推总字数上限', () => {
    // 20.6 秒 × 4.7 字/秒 ≈ 97 字
    const b = deriveDraftCharBudget(20618, 4, 4.7)!
    expect(b.maxTotalChars).toBeGreaterThan(85)
    expect(b.maxTotalChars).toBeLessThan(115)
  })

  it('行数上限不低于段数(否则段数强约束与字数上限自相矛盾)', () => {
    const b = deriveDraftCharBudget(20618, 4, 4.7)!
    expect(b.maxLines).toBeGreaterThanOrEqual(4)
  })

  it('未给语速 → 用通用常数 6 字/秒', () => {
    const b = deriveDraftCharBudget(20000, 4)!
    expect(b.maxTotalChars).toBeCloseTo(20 * 6, -1)
  })

  it('时长非法 → null,调用方不写该字段(维持现状默认)', () => {
    expect(deriveDraftCharBudget(0, 4, 4.7)).toBeNull()
    expect(deriveDraftCharBudget(-1, 4, 4.7)).toBeNull()
  })

  it('极短模板也要给每段留最低可读字数,不能算出 3 个字', () => {
    const b = deriveDraftCharBudget(2000, 4, 4.7)
    expect(b!.maxTotalChars).toBeGreaterThanOrEqual(4 * 6)
  })
})
