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
