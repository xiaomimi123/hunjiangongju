import { describe, it, expect } from 'vitest'
import { baseCss, fontFaceCss, flashCss, subtitleVarsCss } from './layout'

describe('fontFaceCss', () => {
  it('生成 @font-face，本地路径，无外网', () => {
    const css = fontFaceCss([{ family: 'flash-title', url: 'fonts/title.ttf' }])
    expect(css).toContain('@font-face')
    expect(css).toContain("font-family: 'flash-title'")
    expect(css).toContain("url('fonts/title.ttf')")
    expect(css).not.toContain('http')
  })
  it('空数组 → 空串', () => { expect(fontFaceCss([])).toBe('') })
})

describe('flashCss', () => {
  it('含快闪卡与开场标题结构类', () => {
    const c = flashCss()
    for (const k of ['.flash-open', '.fo-title', '.flashcard', '.fc-cover', '.fc-title']) expect(c).toContain(k)
  })
})

describe('subtitleVarsCss', () => {
  it('把字幕色/位置/字体写成 CSS 变量', () => {
    const c = subtitleVarsCss({ subtitleColor: '#ffffff', subtitlePosY: 0.78, subtitleFontFamily: 'subtitle' })
    expect(c).toContain('#ffffff')
    expect(c).toContain('subtitle')
  })
})

describe('baseCss', () => {
  it('baseCss 字幕改用可覆盖变量(带回退)', () => {
    const css = baseCss('warm-literary')
    expect(css).toContain('var(--cap-color')
    expect(css).toContain('var(--cap-bottom')
  })
})
