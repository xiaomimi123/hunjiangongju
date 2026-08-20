import { describe, it, expect } from 'vitest'
import { deriveDraftSpeechRate, deriveDraftCharBudget, MAX_VIDEO_SEC } from './draftCharBudget'
import { CHARS_PER_SEC } from '../pipeline'

describe('deriveDraftSpeechRate', () => {
  it('按总字数/总时长算，忽略空文本与零时长样本', () => {
    const r = deriveDraftSpeechRate([
      { text: '如果你总困在过往的遗憾', durationMs: 2319 },
      { text: '', durationMs: 5000 },
      { text: '忽略我', durationMs: 0 },
    ])
    expect(r).toBeCloseTo(11 / 2.319, 2)
  })
  it('样本不足或语速离谱 → null（宁可回退通用常数也不用脏数据）', () => {
    expect(deriveDraftSpeechRate([])).toBeNull()
    expect(deriveDraftSpeechRate([{ text: '一', durationMs: 60000 }])).toBeNull()   // 0.017 字/秒
    expect(deriveDraftSpeechRate([{ text: '一'.repeat(500), durationMs: 1000 }])).toBeNull() // 500 字/秒
  })
})

// ★ 第一版按**原作者语速**(4.3 字/秒)算预算,得到 89 字 —— 那回答的是
// 「原作者写了多少字」,而不是「我们的配音要多少字才填得满这个时长」。
// 我们的 TTS 约 6 字/秒,89 字只念 14 秒,24.6 秒的模板出来只有 16 秒。
describe('deriveDraftCharBudget —— 按我们自己的语速算', () => {
  it('软预算 = 正片时长 × CHARS_PER_SEC（成片长度贴近原片）', () => {
    const b = deriveDraftCharBudget(20608, 4, 3984)!
    expect(b.maxTotalChars).toBe(Math.round(20.608 * CHARS_PER_SEC))   // 124
    // 客户工程实测正片 20.6s + 开场快闪 4.0s = 24.6s，与原片一致
    expect(3.984 + b.maxTotalChars / CHARS_PER_SEC).toBeCloseTo(24.6, 0)
  })

  it('硬上限对应的成片长度正好是 30 秒', () => {
    const b = deriveDraftCharBudget(20608, 4, 3984)!
    expect(3.984 + b.hardCapChars / CHARS_PER_SEC).toBeCloseTo(MAX_VIDEO_SEC, 1)
  })

  // 硬上限低于软预算的话，AI 刚好写到目标就会被裁
  it('硬上限恒不低于软预算', () => {
    for (const [body, nonBody] of [[20608, 3984], [60000, 5000], [5000, 25000], [3000, 40000]] as const) {
      const b = deriveDraftCharBudget(body, 4, nonBody)!
      expect(b.hardCapChars).toBeGreaterThanOrEqual(b.maxTotalChars)
    }
  })

  it('开场+快闪吃掉的时间会从 30 秒里扣掉', () => {
    const short = deriveDraftCharBudget(20000, 4, 2000)!
    const long = deriveDraftCharBudget(20000, 4, 10000)!
    expect(long.hardCapChars).toBeLessThan(short.hardCapChars)
  })

  it('不给 nonBody 时按「整整 30 秒都念正文」算', () => {
    expect(deriveDraftCharBudget(20000, 4)!.hardCapChars).toBe(MAX_VIDEO_SEC * CHARS_PER_SEC)
  })

  it('极短模板也给每段留最低字数，不产出「每段 3 个字」这种预算', () => {
    const b = deriveDraftCharBudget(500, 8, 1000)!
    expect(b.maxTotalChars).toBeGreaterThanOrEqual(8 * 6)
  })

  it('行数上限不低于段数（否则「恰好 N 段」与「最多 M 行」自相矛盾）', () => {
    expect(deriveDraftCharBudget(500, 12, 1000)!.maxLines).toBeGreaterThanOrEqual(12)
  })

  it('时长非法 → null（调用方不写该字段，维持现状默认）', () => {
    expect(deriveDraftCharBudget(0, 4, 1000)).toBeNull()
    expect(deriveDraftCharBudget(-1, 4, 1000)).toBeNull()
    expect(deriveDraftCharBudget(NaN, 4, 1000)).toBeNull()
  })
})
