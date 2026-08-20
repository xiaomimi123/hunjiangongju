import { describe, it, expect } from 'vitest'
import { rippleHtml, rippleCss, rippleTweens } from './effects'

describe('rippleHtml / rippleCss', () => {
  it('3 个圆环 + 容器，带 data-layout-ignore（不参与自动排版）', () => {
    const h = rippleHtml()
    expect((h.match(/class="rp-ring/g) ?? []).length).toBe(3)
    expect(h).toContain('class="ripple" data-layout-ignore')
    for (const n of [1, 2, 3]) expect(h).toContain(`rp${n}`)
  })

  // 波纹压在字幕上会挡住台词；字幕层是 z-index 13（layout.ts:.scrim/.vignette 附近）
  it('层级低于字幕层', () => {
    expect(rippleCss()).toContain('z-index:12')
  })

  it('容器默认不可见（只有被 tween 点亮的那 458ms 才出现）', () => {
    expect(rippleCss()).toContain('.ripple{position:absolute;inset:0;overflow:hidden;pointer-events:none;z-index:12;opacity:0;}')
  })

  // 只给白环时，浅色配图上肉眼几乎看不见（实测雪景图）。真实水波是波峰亮、波谷暗，
  // 亮边+暗边一起给才在明暗两种底图上都成立。
  it('环同时带亮边与暗边，浅色底图上也看得见', () => {
    const css = rippleCss()
    expect(css).toContain('rgba(255,255,255,0.85)')
    expect(css).toContain('rgba(0,0,0,0.22)')
  })
})

describe('rippleTweens', () => {
  // 客户样例实测：水波纹 3991ms 起、458ms 长，紧贴水滴音（3984ms 起）
  it('样例参数：起点与时长照抄，环错峰荡开', () => {
    const out = rippleTweens(3991, 458)
    expect(out).toContain("tl.set('.ripple', { opacity: 1 }, 3.991)")
    expect(out).toContain("tl.fromTo('.rp1'")
    expect(out).toContain('scale: 20')          // 荡出画面（>720×960 对角线）
    expect(out).toContain("tl.set('.ripple', { opacity: 0 }, 4.449)")  // 3.991+0.458
  })

  it('三个环起点各不相同（否则糊成一个环）', () => {
    const out = rippleTweens(4000, 500)
    const starts = [...out.matchAll(/tl\.fromTo\('\.rp\d'[^;]*, ([\d.]+)\);/g)].map((m) => m[1])
    expect(starts).toHaveLength(3)
    expect(new Set(starts).size).toBe(3)
  })

  it('seek-safe：无函数式取值', () => {
    const out = rippleTweens(4000, 500)
    expect(out).not.toContain('function')
    expect(out).not.toContain('=>')
  })

  it('时长为 0 或负 → 空串，不产出退化 tween', () => {
    expect(rippleTweens(4000, 0)).toBe('')
    expect(rippleTweens(4000, -100)).toBe('')
  })
})
