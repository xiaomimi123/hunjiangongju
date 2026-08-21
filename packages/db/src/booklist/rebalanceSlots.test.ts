import { describe, it, expect } from 'vitest'
import { rebalanceToSlotChars, splitSentences } from './rebalanceSlots'
import { slotDurationsForSegments, charBudgetsFromWeights } from './draftCharBudget'

const len = (s: string) => Array.from(s).length

describe('splitSentences', () => {
  it('标点跟着前半句', () => {
    expect(splitSentences('甲，乙。丙')).toEqual(['甲，', '乙。', '丙'])
  })
  it('换行断句但不产生空句', () => {
    expect(splitSentences('甲。\n\n乙')).toEqual(['甲。', '乙'])
  })
  it('空输入 → 空数组', () => {
    expect(splitSentences('')).toEqual([])
    expect(splitSentences(null as unknown as string)).toEqual([])
  })
})

describe('rebalanceToSlotChars', () => {
  // ★ 这条复刻线上事故的形状：117 字的文案里最后一段被塞了约一半，
  // 配音 13464ms 对着草稿 6067ms 的槽位（+122%），成片 24.6→31.3 秒。
  it('某段远超配额时，按槽位比例重排', () => {
    const lines = ['甲，乙。', '丙，丁。', '戊，己，庚，辛，壬，癸，子，丑，寅，卯，辰，巳。']
    const before = lines.map(len)
    const out = rebalanceToSlotChars(lines, [10, 14, 10])
    expect(out).not.toEqual(lines)
    // 重排后最长段与最短段的比值必须明显收窄
    const spread = (a: string[]) => Math.max(...a.map(len)) / Math.min(...a.map(len))
    expect(spread(out), `没有收窄: ${before} → ${out.map(len)}`).toBeLessThan(spread(lines) / 2)
  })

  it('一个字都不丢（重排前后拼接完全相同）', () => {
    const lines = ['甲，乙。', '丙，丁。', '戊，己，庚，辛，壬，癸，子，丑，寅，卯，辰，巳。']
    expect(rebalanceToSlotChars(lines, [10, 14, 10]).join('')).toBe(lines.join(''))
  })

  it('段数不变', () => {
    const lines = ['甲，乙。', '丙，丁。', '戊，己，庚，辛，壬，癸，子，丑，寅，卯，辰，巳。']
    expect(rebalanceToSlotChars(lines, [10, 14, 10]).length).toBe(3)
  })

  // ★ 克制：分布本来就大致合规时**不动**。重排会打乱 LLM 原本的段落语义
  //（每段对应一张配图），不该为了几个字的偏差就重排。
  // 数据必须**能**被重排（标点足够切出多于段数的句子），否则这条会走
  // 「切不出足够句子 → 原样返回」那条分支，测不到容差判定（第一版就是这么假绿的）。
  it('分布已在容差内 → 原样返回同一个数组', () => {
    const lines = ['甲，乙，丙，丁，', '戊，己，庚，辛，壬，', '癸，子，丑，']
    expect(splitSentences(lines.join('')).length).toBeGreaterThan(lines.length)
    expect(rebalanceToSlotChars(lines, [8, 10, 6])).toBe(lines)
  })

  it('输入不合法（长度不符/非数组/目标非正）→ 原样返回', () => {
    const lines = ['甲，', '乙。']
    expect(rebalanceToSlotChars(lines, [10])).toBe(lines)
    expect(rebalanceToSlotChars(lines, [10, 0])).toBe(lines)
    expect(rebalanceToSlotChars(lines, null as unknown as number[])).toBe(lines)
  })

  // 句子数少于段数时重排必然掏空某段，宁可不动
  it('切不出足够句子 → 原样返回', () => {
    const lines = ['甲乙丙丁戊己庚辛壬癸子丑寅卯辰', '巳']
    expect(rebalanceToSlotChars(lines, [2, 12])).toBe(lines)
  })

  // ★ 重排的目标是让各段字数的**比例**贴合槽位时长的比例，而不是压总量。
  // 第一版直接用配额绝对值：前几段各自填到配额就停，超出的部分**全部**落进
  // 最后一段——正是要修的症状换个地方复发。这条就是钉住那个回归。
  it('总字数超配额时，超出部分按比例摊开而不是全压给最后一段', () => {
    // 槽位比例 1:2:1，实际字数是配额的两倍
    const sents = Array.from({ length: 16 }, (_, i) => `第${i}句，`)
    const lines = [sents.slice(0, 2).join(''), sents.slice(2, 4).join(''), sents.slice(4).join('')]
    const out = rebalanceToSlotChars(lines, [10, 20, 10])
    const got = out.map(len)
    const total = got.reduce((a, b) => a + b, 0)
    // 阈值要卡在「按比例」与「均摊」之间：槽位比例 1:2:1 → 应得 .25/.50/.25；
    // 若忘了等比缩放，DP 会把超出量**均摊**成 .30/.40/.30 —— 松阈值对这两种都放行。
    expect(got[2] / total, `末段占比不对（超出量没按比例摊）: ${got}`).toBeLessThan(0.3)
    expect(got[1] / total, `中段没拿到应有的份额: ${got}`).toBeGreaterThan(0.45)
  })

  // ★ 与真实草稿参数联调：槽位 [3984, 5703, 8064, 6067]，正片三段
  it('接草稿真实槽位：重排后各段字数比例贴近槽位时长比例', () => {
    const slots = slotDurationsForSegments(3984, [780, 5703, 8064, 6067], 4)
    const budgets = charBudgetsFromWeights(slots, 124)
    const body = ['甲，乙。', '丙，丁。', Array.from({ length: 14 }, (_, i) => `第${i}句，`).join('')]
    const out = rebalanceToSlotChars(body, budgets.slice(1))
    const got = out.map(len)
    const total = got.reduce((a, b) => a + b, 0)
    const want = [5703, 8064, 6067].map((d) => d / 19834)
    got.forEach((c, i) => {
      expect(Math.abs(c / total - want[i]), `第 ${i} 段比例 ${(c / total).toFixed(3)} 偏离目标 ${want[i].toFixed(3)}: ${got}`)
        .toBeLessThan(0.09)
    })
  })
})

describe('slotDurationsForSegments —— 两侧共用的槽位表', () => {
  // ★ 这就是配额错位一格的根因：文案侧传 segCount(4)、配音侧传 segCount-1(3)，
  // 同一个函数被喂了不同的 n。现在两侧都取这一份含第 0 格的完整表。
  it('第 0 格是开场+快闪，其后依次是正片槽位', () => {
    expect(slotDurationsForSegments(3984, [780, 5703, 8064, 6067], 4)).toEqual([3984, 5703, 8064, 6067])
  })
  it('780ms 的纯画面段被滤掉，不占正片槽位', () => {
    expect(slotDurationsForSegments(3984, [780, 5703, 8064, 6067], 4)).not.toContain(780)
  })
  it('草稿没有可用正片槽位 → 空数组（调用方维持原行为）', () => {
    expect(slotDurationsForSegments(3984, [], 4)).toEqual([])
    expect(slotDurationsForSegments(3984, undefined, 4)).toEqual([])
    expect(slotDurationsForSegments(3984, [800], 4)).toEqual([])
  })
  it('openFlashMs 缺失（classic 模板）时第 0 格用兜底值而不是 0', () => {
    const out = slotDurationsForSegments(0, [5703, 8064, 6067], 4)
    expect(out[0]).toBeGreaterThan(0)
  })
  it('段数少于 2 → 空数组（没有正片段可分）', () => {
    expect(slotDurationsForSegments(3984, [5703], 1)).toEqual([])
  })
})
