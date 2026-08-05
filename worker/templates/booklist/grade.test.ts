import { describe, it, expect } from 'vitest'
import { gradeCss } from './grade'

describe('gradeCss', () => {
  it('无 grade → 空串（老框架零影响）', () => {
    expect(gradeCss(undefined)).toBe('')
  })
  it('具名滤镜「青橙」按强度插值，且叠乘草稿对比度', () => {
    const css = gradeCss({ filterName: '青橙', intensity: 0.5, contrast: -0.2, sharpen: false })
    expect(css).toContain('.scene .photo')
    expect(css).toContain('filter:')
    // 强度 0.5 → sepia 0.09 (满配方 0.18 的一半)
    expect(css).toContain('sepia(0.09)')
    // 对比度：满配方 1.12 插值到 1.06，再叠乘 (1 + -0.2)=0.8 → 0.848
    expect(css).toContain('contrast(0.848)')
  })
  it('未内置的滤镜名 → 只套对比度,不加偏色', () => {
    const css = gradeCss({ filterName: '不存在的滤镜', intensity: 1, contrast: 0.25, sharpen: false })
    expect(css).toContain('contrast(1.25)')
    expect(css).not.toContain('sepia')
    expect(css).not.toContain('hue-rotate')
  })
  it('全中性（无滤镜且对比度 0）→ 空串,不产生无意义的 filter', () => {
    expect(gradeCss({ filterName: '', intensity: 0, contrast: 0, sharpen: false })).toBe('')
  })
  it('对比度越界（< -1）被钳制到 -1，不产生非法负值使整条 filter 声明失效', () => {
    const clamped = gradeCss({ filterName: '青橙', intensity: 0.5, contrast: -1, sharpen: false })
    const overshoot = gradeCss({ filterName: '青橙', intensity: 0.5, contrast: -3, sharpen: false })
    expect(overshoot).toBe(clamped)
    expect(overshoot).toContain('contrast(0)')
    expect(overshoot).not.toMatch(/contrast\(-/)
  })
})
