import { describe, it, expect } from 'vitest'
import { DEFAULT_PARAMS, parseTemplateParams, flashTimeline } from './templateParams'

describe('parseTemplateParams', () => {
  it('缺省 → classic + 默认值', () => {
    const p = parseTemplateParams(undefined)
    expect(p.mode).toBe('classic')
    expect(p.audio.bgmVolume).toBe(DEFAULT_PARAMS.audio.bgmVolume)
  })
  it('mode=flash 生效，其余字段深合并默认', () => {
    const p = parseTemplateParams({ mode: 'flash', body: { subtitleColor: '#ff0' } })
    expect(p.mode).toBe('flash')
    expect(p.body.subtitleColor).toBe('#ff0')
    expect(p.body.subtitlePosY).toBe(DEFAULT_PARAMS.body.subtitlePosY) // 未给的仍默认
    expect(p.open.titleText).toBe(DEFAULT_PARAMS.open.titleText)
  })
  it('非法 mode / 非对象 → classic', () => {
    expect(parseTemplateParams({ mode: 'weird' }).mode).toBe('classic')
    expect(parseTemplateParams('x').mode).toBe('classic')
    expect(parseTemplateParams(null).mode).toBe('classic')
  })
})

describe('flashTimeline', () => {
  it('开场取 min(durationMs, seg0*0.55)，快闪均分剩余窗口', () => {
    const p = parseTemplateParams({ mode: 'flash' }) // open.durationMs=2160
    const t = flashTimeline(p, 4000, 9)
    expect(t.openEndMs).toBe(2160) // min(2160, 2200)
    expect(t.flashEndMs).toBe(4000)
    expect(t.count).toBe(9)
    expect(t.perClipMs).toBeCloseTo((4000 - 2160) / 9, 3)
  })
  it('seg0 很短 → 开场按 55% 收缩，perClipMs 不低于 minClipMs', () => {
    const p = parseTemplateParams({ mode: 'flash', flash: { minClipMs: 120 } })
    const t = flashTimeline(p, 2000, 20) // 剩余(2000-1100)/20=45 < 120 → 夹到 120
    expect(t.openEndMs).toBe(1100) // 2000*0.55
    expect(t.perClipMs).toBe(120)
  })
  it('bookCount=0 → perClipMs=0、count=0（不崩）', () => {
    const t = flashTimeline(parseTemplateParams({ mode: 'flash' }), 4000, 0)
    expect(t.count).toBe(0)
    expect(t.perClipMs).toBe(0)
  })
})

describe('grade 可选字段', () => {
  it('缺省 → grade 为 undefined,其余字段与既有默认一致', () => {
    const p = parseTemplateParams({})
    expect(p.grade).toBeUndefined()
    expect(p.body.subtitleColor).toBe(DEFAULT_PARAMS.body.subtitleColor)
  })
  it('合法 grade 原样保留并数值兜底', () => {
    expect(parseTemplateParams({ grade: { filterName: '青橙', intensity: 0.5, contrast: -0.2, sharpen: true } }).grade)
      .toEqual({ filterName: '青橙', intensity: 0.5, contrast: -0.2, sharpen: true })
  })
  it('非法 grade（非对象/字段类型错）→ 丢弃或字段回落', () => {
    expect(parseTemplateParams({ grade: 'x' }).grade).toBeUndefined()
    expect(parseTemplateParams({ grade: { filterName: 42, intensity: 'a', contrast: null, sharpen: 1 } }).grade)
      .toEqual({ filterName: '', intensity: 0, contrast: 0, sharpen: false })
  })
})

describe('motion / flash.scale / body.photoScale 可选字段', () => {
  it('缺省 → 三者 undefined', () => {
    const p = parseTemplateParams({})
    expect(p.motion).toBeUndefined()
    expect(p.flash.scale).toBeUndefined()
    expect(p.body.photoScale).toBeUndefined()
  })
  it('给合法值 → 原样保留', () => {
    const p = parseTemplateParams({
      motion: { moves: ['push-in', 'pan-left'] },
      flash: { scale: 1.1 },
      body: { photoScale: 1.2978 },
    })
    expect(p.motion).toEqual({ moves: ['push-in', 'pan-left'] })
    expect(p.flash.scale).toBe(1.1)
    expect(p.body.photoScale).toBe(1.2978)
  })
  it('motion.moves 含非字符串 → 过滤掉', () => {
    const p = parseTemplateParams({ motion: { moves: ['push-in', 42, null, ''] } })
    expect(p.motion).toEqual({ moves: ['push-in'] })
  })
  it('flash.scale 非数字 → 字段不存在', () => {
    expect(parseTemplateParams({ flash: { scale: 'x' } }).flash.scale).toBeUndefined()
    expect(parseTemplateParams({ body: { photoScale: NaN } }).body.photoScale).toBeUndefined()
  })
})

describe('body.subtitleEntrance 可选字段', () => {
  it('缺省 → undefined', () => {
    expect(parseTemplateParams({}).body.subtitleEntrance).toBeUndefined()
  })
  it('给合法值 → 原样保留', () => {
    expect(parseTemplateParams({ body: { subtitleEntrance: 'char-stagger' } }).body.subtitleEntrance).toBe('char-stagger')
  })
  it('非字符串/空字符串 → 字段不存在', () => {
    expect(parseTemplateParams({ body: { subtitleEntrance: 42 } }).body.subtitleEntrance).toBeUndefined()
    expect(parseTemplateParams({ body: { subtitleEntrance: '' } }).body.subtitleEntrance).toBeUndefined()
  })
})

// 原工程每张快闪卡时长各不相同(150/251/195/191/204/197/189/222/221ms),
// 而 flashTimeline 用 win/count 等分窗口,九张卡必然等间隔——实测成片切点偏差最大 58.7ms(近两帧)。
// 修法:保留草稿的相对节奏比例,缩放到实际窗口(窗口长度由第0段配音时长决定,未必等于草稿)。
describe('flashTimeline —— 逐卡时长', () => {
  const base = { ...DEFAULT_PARAMS, mode: 'flash' as const }

  it('无 clipMs → 维持等分行为(零回归)', () => {
    const t = flashTimeline(base, 4000, 4)
    expect(t.offsets).toBeUndefined()
    expect(t.perClipMs).toBeGreaterThan(0)
  })

  it('有 clipMs → 按相对比例给出各卡起点偏移', () => {
    const p = { ...base, flash: { ...base.flash, clipMs: [100, 300, 100, 300] } }
    // 窗口 = 4000 - openEnd；比例 1:3:1:3 应原样保留
    const t = flashTimeline(p, 4000, 4)
    expect(t.offsets).toHaveLength(4)
    const d = t.offsets!.map((o, i) => (i + 1 < t.offsets!.length ? t.offsets![i + 1] - o : t.flashEndMs - t.openEndMs - o))
    // 第2段应约为第1段的3倍
    expect(d[1] / d[0]).toBeCloseTo(3, 1)
    expect(d[3] / d[2]).toBeCloseTo(3, 1)
  })

  it('各卡时长之和恰好填满窗口(不留空、不溢出)', () => {
    const p = { ...base, flash: { ...base.flash, clipMs: [150, 251, 195, 191] } }
    const t = flashTimeline(p, 5000, 4)
    const win = t.flashEndMs - t.openEndMs
    expect(t.offsets![0]).toBe(0)
    expect(t.offsets![3]).toBeLessThan(win)
  })

  it('卡数多于 clipMs 条目 → 循环复用比例,不越界', () => {
    const p = { ...base, flash: { ...base.flash, clipMs: [100, 300] } }
    const t = flashTimeline(p, 4000, 5)
    expect(t.offsets).toHaveLength(5)
    expect(t.offsets!.every((o, i) => i === 0 || o > t.offsets![i - 1])).toBe(true)
  })

  it('clipMs 全为 0 或负 → 忽略,回退等分(防除零)', () => {
    const p = { ...base, flash: { ...base.flash, clipMs: [0, 0, 0] } }
    expect(flashTimeline(p, 4000, 3).offsets).toBeUndefined()
  })
})
