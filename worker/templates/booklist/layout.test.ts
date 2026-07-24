import { describe, it, expect } from 'vitest'
import { baseCss, sceneHtml, titleCardHtml, watermarkHtml, bookHeaderHtml, overlayDecorHtml } from './layout'

describe('baseCss', () => {
  it('结构 CSS 用 CSS 变量、.photo 留 -30px 余量', () => {
    const css = baseCss('warm-literary')
    expect(css).toContain('var(--bg)')
    expect(css).toContain('var(--fs-cap-zh)')
    expect(css).toContain('inset: -30px')
    expect(css).toContain('.scrim') // 字幕压暗底
  })
})

describe('sceneHtml', () => {
  it('含模糊背景填充与主图', () => {
    const html = sceneHtml(2, 'media/02.png')
    expect(html).toContain('class="scene s2"')
    expect(html).toContain('class="bg-fill"')
    expect(html).toContain('class="photo"')
    expect(html).toContain("url('media/02.png')")
  })
})

describe('titleCardHtml / watermarkHtml / bookHeaderHtml', () => {
  it('标题卡带 data-layout-ignore 与转义', () => {
    expect(titleCardHtml('《活着 <x>》', '余华')).toContain('class="title-card" data-layout-ignore')
    expect(titleCardHtml('《活着 <x>》', '余华')).toContain('&lt;x&gt;')
  })
  it('无副标题时不渲染副标题行', () => {
    expect(titleCardHtml('T', '')).not.toContain('tc-subtitle')
  })
  it('水印转义', () => {
    expect(watermarkHtml('@号 <a>')).toContain('class="watermark" data-layout-ignore')
    expect(watermarkHtml('@号 <a>')).toContain('&lt;a&gt;')
  })
  it('书名头带 kicker 与作者', () => {
    const h = bookHeaderHtml(1, '活着', '余华')
    expect(h).toContain('class="book-header bh1" data-layout-ignore')
    expect(h).toContain('bh-kicker')
    expect(h).toContain('《活着》')
    expect(h).toContain('余华')
  })
})

describe('overlayDecorHtml', () => {
  it('总有暗角；ink-oriental 追加颗粒层', () => {
    expect(overlayDecorHtml('warm-literary')).toContain('class="vignette"')
    expect(overlayDecorHtml('warm-literary')).not.toContain('class="grain"')
    expect(overlayDecorHtml('ink-oriental')).toContain('class="grain"')
  })
})
