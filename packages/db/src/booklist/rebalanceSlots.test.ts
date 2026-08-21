import { describe, it, expect } from 'vitest'
import { rebalanceToSlotChars, splitSentences } from './rebalanceSlots'
import { slotDurationsForSegments, charBudgetsFromWeights, speechCapacities, charsForSpeechMs, BOOK_TITLE_LEAD_MS } from './draftCharBudget'

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

describe('rebalanceToSlotChars —— 写太少也算失衡', () => {
  // ★ 判定必须双向。第一版只判「写太多」：线上那条片子段2 只写到配额的 0.71 倍
  //（29 字 / 配额 41），不触发重排 —— 8 秒的槽位里有 3 秒没人说话，靠补静音填成静场。
  it('某段远低于配额（0.7×）时也触发重排', () => {
    // 段0 塞满、段1 空荡：段1 只有配额的 ~0.3 倍，但没有任何一段超出 1.4 倍
    const long = Array.from({ length: 12 }, (_, i) => `甲${i}，`).join('')
    const short = '乙，'
    const lines = [long, short]
    // 先确认「只判写太多」的话这组数据不会触发
    expect(Array.from(long).length / 30).toBeLessThan(1.4)
    const out = rebalanceToSlotChars(lines, [30, 30])
    expect(out, `写太少没被判为失衡: ${lines.map(len)}`).not.toEqual(lines)
    const got = out.map(len)
    expect(Math.min(...got) / Math.max(...got), `重排后仍然一头沉: ${got}`).toBeGreaterThan(0.6)
  })
})

describe('speechCapacities —— 占多长 ≠ 能说多久', () => {
  const timeline = [3984, 5703, 8064, 6067]

  // ★ 第 0 段在时间轴上占「开场+快闪」整个窗口，但话只能说到碎裂动画结束为止：
  // 快闪那一段（书封一张张翻过去）原片没有旁白。此前按整个窗口给字数，
  // 开场白被写成 27 字念了 5064ms，整个快闪期间都在说话。
  it('第 0 段的可说话时长 = 开场碎裂窗口，不含快闪', () => {
    expect(speechCapacities(timeline, 2159)[0]).toBe(2159)
  })

  // 断言具体值而不是 `5703 - BOOK_TITLE_LEAD_MS`：后者是恒等式，
  // 把常数置 0 时两边一起变成 5703，照样绿（第一版就是这么假绿的）。
  it('第 1 段头部扣掉书名前的留白', () => {
    expect(BOOK_TITLE_LEAD_MS, '留白被去掉了，书名会紧贴快闪出口').toBeGreaterThan(0)
    expect(speechCapacities(timeline, 2159)[1]).toBe(5303)
  })

  it('其余段不动（留白只在这两处）', () => {
    const cap = speechCapacities(timeline, 2159)
    expect(cap[2]).toBe(8064)
    expect(cap[3]).toBe(6067)
  })

  it('openWindowMs 缺失/不小于第 0 格 → 第 0 段不裁（classic 模板零回归）', () => {
    expect(speechCapacities(timeline, 0)[0]).toBe(3984)
    expect(speechCapacities(timeline, 9999)[0]).toBe(3984)
  })

  it('空槽位表 → 空数组', () => {
    expect(speechCapacities([], 2159)).toEqual([])
  })

  // ★ 效果验收：按可说话时长分字数，开场白的配额必须明显小于按占位时长分的
  it('按可说话时长分字数：开场白配额被砍下来', () => {
    const byTimeline = charBudgetsFromWeights(timeline, 124)
    const byCapacity = charBudgetsFromWeights(speechCapacities(timeline, 2159), 124)
    expect(byCapacity[0], `开场白配额没被砍: ${byTimeline[0]} → ${byCapacity[0]}`).toBeLessThan(byTimeline[0] * 0.7)
  })
})

describe('charsForSpeechMs —— 按实测语速折算字数', () => {
  it('按实测语速折算（5.5 字/秒）', () => {
    expect(charsForSpeechMs(2000)).toBe(11)
    expect(charsForSpeechMs(10000)).toBe(55)
  })
  // ★ 常数必须比换音色前那个 6 小：实测这条克隆音色是 5.56 字/秒，
  // 按 6 推预算会系统性偏松约 8%，每段都得靠变速压回来。
  // 用 10 秒而不是 1 秒来比：1 秒时 round(5.5)=6，取整会把差别抹平。
  it('比换音色前的 CHARS_PER_SEC=6 保守', () => {
    expect(charsForSpeechMs(10_000)).toBeLessThan(60)
  })
  it('非法时长 → 0', () => {
    expect(charsForSpeechMs(0)).toBe(0)
    expect(charsForSpeechMs(NaN)).toBe(0)
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
