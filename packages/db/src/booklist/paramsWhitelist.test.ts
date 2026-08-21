import { describe, it, expect } from 'vitest'
import { sanitizeParamsOverride } from './paramsWhitelist'

describe('sanitizeParamsOverride —— 白名单', () => {
  // ★ 死字段一律丢弃。这些字段草稿解析出来了但渲染器根本不读（已逐个 grep 核实），
  // 放行等于让运营调空气：界面改了、保存成功了、成片一点变化没有。
  it('丢弃渲染层不读的死字段', () => {
    const out = sanitizeParamsOverride({
      body: { kenBurns: 'off', photoScale: 1.2, subtitleEntrance: 'fade', subtitleFontFamily: '楷体' },
      flash: { scale: 1.5, hardCut: true, titleFontFamily: 'X' },
      transition: { enterBodyHardCut: true },
      motion: { moves: ['push-in'] },
      grade: { filterName: '冷调' },
    })
    expect(out).toBeNull()
  })

  it('认不出的键直接丢弃', () => {
    expect(sanitizeParamsOverride({ 随便写的: 1, body: { 乱来: 2 } })).toBeNull()
  })

  it('非对象输入 → null', () => {
    expect(sanitizeParamsOverride(null)).toBeNull()
    expect(sanitizeParamsOverride([1, 2])).toBeNull()
    expect(sanitizeParamsOverride('x')).toBeNull()
  })

  // ★ 只输出请求里真正给了的字段，**不补默认值**。
  // 补了默认值等于把框架里没配过的字段也钉死，框架以后再改也带不动这条任务。
  it('只输出给到的字段，不补默认值', () => {
    expect(sanitizeParamsOverride({ audio: { bgmVolume: 0.4 } })).toEqual({ audio: { bgmVolume: 0.4 } })
  })

  describe('节奏', () => {
    it('逐段时长取整并夹在合理区间', () => {
      const out = sanitizeParamsOverride({ body: { slotDurationsMs: [5703.4, 8064, 999_999] } })
      expect(out).toEqual({ body: { slotDurationsMs: [5703, 8064, 60_000] } })
    })
    it('数组里混入非数字 → 整个数组丢弃（不产出半截时间轴）', () => {
      expect(sanitizeParamsOverride({ body: { slotDurationsMs: [5703, 'x'] } })).toBeNull()
    })
    it('空数组丢弃', () => {
      expect(sanitizeParamsOverride({ body: { slotDurationsMs: [] } })).toBeNull()
    })
  })

  describe('转场', () => {
    // ★ 渲染层只实现了 crossfade，契约里另外四种全部退化成叠化。
    // 做成四选一的下拉框就是骗人，所以 renderType 一律固定写成 crossfade，
    // 硬切用**时长 0** 表达。
    it('renderType 一律固定为 crossfade，不接受其它类型', () => {
      const out = sanitizeParamsOverride({
        transition: { bodyCycle: [{ renderType: 'wipe', durationMs: 500 }, { renderType: 'shard', durationMs: 300 }] },
      })
      expect(out).toEqual({
        transition: { type: 'dissolve', bodyCycle: [
          { renderType: 'crossfade', durationMs: 500 },
          { renderType: 'crossfade', durationMs: 300 },
        ] },
      })
    })
    it('时长 0 保留（= 该边界硬切），负值夹到 0', () => {
      const out = sanitizeParamsOverride({ transition: { bodyCycle: [{ durationMs: 0 }, { durationMs: -100 }] } })
      const cyc = (out!.transition as Record<string, unknown>).bodyCycle as { durationMs: number }[]
      expect(cyc.map((c) => c.durationMs)).toEqual([0, 0])
    })
    it('时长上限 2000ms', () => {
      const out = sanitizeParamsOverride({ transition: { durationMs: 99_999 } })
      expect((out!.transition as Record<string, unknown>).durationMs).toBe(2000)
    })
  })

  describe('运镜', () => {
    it('逐段缩放放行，同时补上空的 moves 保持结构完整', () => {
      const out = sanitizeParamsOverride({ motion: { keyframes: [{ scaleFrom: 1, scaleTo: 1.108 }] } })
      expect(out).toEqual({ motion: { moves: [], keyframes: [{ scaleFrom: 1, scaleTo: 1.108 }] } })
    })
    it('缩放夹在 1~2（缩小会露出画布边缘）', () => {
      const out = sanitizeParamsOverride({ motion: { keyframes: [{ scaleFrom: 0.2, scaleTo: 9 }] } })
      expect((out!.motion as Record<string, unknown>).keyframes).toEqual([{ scaleFrom: 1, scaleTo: 2 }])
    })
    it('请求里只给 moves（死字段）→ 不产出 motion', () => {
      expect(sanitizeParamsOverride({ motion: { moves: ['push-in', 'pan-left'] } })).toBeNull()
    })
  })

  describe('配乐', () => {
    it('音量夹在 0~1，起点与淡化取整', () => {
      const out = sanitizeParamsOverride({ audio: { bgmVolume: 3, bgmStartMs: 30_500.7, bgmFadeInMs: -5, bgmFadeOutMs: 1500 } })
      expect(out).toEqual({ audio: { bgmVolume: 1, bgmStartMs: 30_501, bgmFadeInMs: 0, bgmFadeOutMs: 1500 } })
    })
    it('音量 0 是合法值（静音 BGM），不能被当成"没给"', () => {
      expect(sanitizeParamsOverride({ audio: { bgmVolume: 0 } })).toEqual({ audio: { bgmVolume: 0 } })
    })
  })

  describe('文字层', () => {
    it('位置夹在 0~1、相对字号夹在 0.2~5', () => {
      const out = sanitizeParamsOverride({ text: { bookTitlePosY: 1.9, bookTitleScale: 88, openTitlePosY: -1 } })
      expect(out).toEqual({ text: { openTitlePosY: 0, bookTitlePosY: 1, bookTitleScale: 5 } })
    })
  })

  it('颜色必须是 #RRGGBB，其它写法丢弃', () => {
    expect(sanitizeParamsOverride({ body: { subtitleColor: '#fff' } })).toBeNull()
    expect(sanitizeParamsOverride({ body: { subtitleColor: 'red' } })).toBeNull()
    expect(sanitizeParamsOverride({ body: { subtitleColor: '#FFEE00' } }))
      .toEqual({ body: { subtitleColor: '#FFEE00' } })
  })
})
