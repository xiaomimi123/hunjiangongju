import { describe, it, expect } from 'vitest'
import { ENTRANCES, pickEntrance, captionUnit } from './captionsAnim'

describe('pickEntrance', () => {
  it('确定性且随 index 轮换', () => {
    expect(pickEntrance(0, 0)).toBe(pickEntrance(0, 0))
    expect(pickEntrance(0, 0)).not.toBe(pickEntrance(1, 0))
  })
})

describe('pickEntrance 固定入场', () => {
  it('给了合法 fixed 就恒定返回它', () => {
    expect(pickEntrance(0, 0, 'char-stagger')).toBe('char-stagger')
    expect(pickEntrance(7, 3, 'char-stagger')).toBe('char-stagger')
  })
  it('非法/未给 → 回落原轮换', () => {
    expect(pickEntrance(2, 1, 'nope')).toBe(pickEntrance(2, 1))
    expect(pickEntrance(2, 1)).toBe(pickEntrance(2, 1, undefined))
  })
})

describe('captionUnit', () => {
  it('产出 .capN 容器与中文，转义特殊字符', () => {
    const u = captionUnit({ n: 1, entrance: 'fade-up', zh: '第一句 <x>', startMs: 0, endMs: 2000 })
    expect(u.html).toContain('class="cap cap1" data-layout-ignore')
    expect(u.html).toContain('第一句 &lt;x&gt;')
    expect(u.tweens).toContain(".cap1'")
  })
  it('入场 tween 起点=startMs 秒，结尾在 endMs 秒收起', () => {
    const u = captionUnit({ n: 2, entrance: 'fade-up', zh: '句', startMs: 2000, endMs: 4500 })
    expect(u.tweens).toContain(', 2)') // 入场起点
    expect(u.tweens).toContain("tl.set('.cap2', { opacity: 0 }, 4.5)")
  })
  it('有 en 时渲染 .cap-en', () => {
    const u = captionUnit({ n: 1, entrance: 'fade-up', zh: 'z', en: 'hello', startMs: 0, endMs: 1000 })
    expect(u.html).toContain('class="cap-en"')
    expect(u.html).toContain('hello')
  })
  it('无 en 时不渲染 .cap-en', () => {
    const u = captionUnit({ n: 1, entrance: 'fade-up', zh: 'z', startMs: 0, endMs: 1000 })
    expect(u.html).not.toContain('cap-en')
  })
  it('char-stagger：中文逐字拆 span、初始态烘焙内联、GSAP 只 to 归位', () => {
    const u = captionUnit({ n: 1, entrance: 'char-stagger', zh: '三个字', startMs: 0, endMs: 2000 })
    expect((u.html.match(/class="ch"/g) ?? []).length).toBe(3)
    expect(u.html).toContain('opacity:0') // 烘焙初始态
    expect(u.tweens).toContain(".cap1 .ch'")
    expect(u.tweens).not.toContain('function')
  })
  it('所有入场型都无 function-based 值', () => {
    for (const e of ENTRANCES) {
      const u = captionUnit({ n: 1, entrance: e, zh: '字', startMs: 0, endMs: 1000 })
      expect(u.tweens).not.toContain('function')
      expect(u.tweens).not.toContain('=>')
    }
  })
})
