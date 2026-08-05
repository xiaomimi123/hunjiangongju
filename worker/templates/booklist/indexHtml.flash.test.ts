import { describe, it, expect } from 'vitest'
import { renderIndexHtml, type BodyData } from './indexHtml'
import { parseTemplateParams } from './templateParams'

const flashData: BodyData = {
  size: { width: 720, height: 960 },
  overlay: { title: '', subtitle: '', watermark: '@读书号' },
  images: [{ src: 'media/01.png' }, { src: 'media/02.png' }],
  seed: 's1',
  template: 'flash',
  templateParams: parseTemplateParams({ mode: 'flash' }),
  flashCovers: [
    { title: '活着', author: '余华', coverSrc: 'covers/01.png' },
    { title: '兄弟', coverSrc: 'covers/02.png' },
  ],
  fonts: [{ family: 'flash-title', url: 'fonts/title.ttf' }, { family: 'subtitle', url: 'fonts/sub.otf' }],
  segments: [
    { seqNo: 1, startMs: 0, endMs: 4000, subtitle: '今天分享的是', imageIndex: 0 },
    { seqNo: 2, startMs: 4000, endMs: 9000, subtitle: '如果你总困在过往', imageIndex: 1,
      captionBeats: [{ zh: '如果你总困在过往', startMs: 4000, endMs: 9000 }] },
  ],
}

describe('renderIndexHtml — flash 分支', () => {
  const html = renderIndexHtml(flashData)
  it('契约仍在、seek-safe、总时长=末段', () => {
    expect(html).toContain('data-composition-id="main"')
    expect(html).toContain('data-duration="9"')
    expect(html).toContain('window.__timelines["main"] = tl;')
    expect(html).not.toContain('function'); expect(html).not.toContain('=>'); expect(html).not.toContain('Math.random')
    expect(html).not.toContain('cdn.jsdelivr.net')
  })
  it('含开场标题 + 书封快闪卡 + @font-face', () => {
    expect(html).toContain('class="flash-open"')
    expect(html).toContain('今天分享的是')
    expect((html.match(/class="flashcard/g) ?? []).length).toBe(2)
    expect(html).toContain('活着')
    expect(html).toContain('@font-face')
    expect(html).toContain("url('fonts/title.ttf')")
  })
  it('正片段(seg2)仍出场景+字幕', () => {
    expect(html).toContain('如果你总困在过往')
  })
  it('确定性', () => { expect(renderIndexHtml(flashData)).toBe(renderIndexHtml(flashData)) })
})

describe('renderIndexHtml — classic 回归', () => {
  it('无 template 字段 → 走 classic，不含快闪', () => {
    const classic: BodyData = { ...flashData, template: undefined, templateParams: undefined, flashCovers: undefined }
    const html = renderIndexHtml(classic)
    expect(html).not.toContain('class="flash-open"')
    expect(html).not.toContain('class="flashcard')
    expect(html).toContain('data-composition-id="main"')
  })
})

describe('renderIndexHtml — flash 分支调色注入', () => {
  it('templateParams.grade 存在(真实新模板样本值) → 渲染 HTML 含对应 filter 声明', () => {
    const withGrade: BodyData = {
      ...flashData,
      templateParams: parseTemplateParams({
        mode: 'flash',
        grade: { filterName: '青橙', intensity: 0.503, contrast: -0.2138, sharpen: true },
      }),
    }
    const html = renderIndexHtml(withGrade)
    expect(html).toContain(
      '.scene .photo, .flashcard .fc-cover { filter: contrast(0.834) saturate(1.126) sepia(0.091) hue-rotate(-5.03deg); }'
    )
  })
  it('templateParams.grade 缺省 → 渲染 HTML 不含任何调色 filter 声明', () => {
    const html = renderIndexHtml(flashData) // flashData.templateParams 无 grade 字段
    expect(html).not.toContain('filter: contrast(')
  })
})

describe('renderIndexHtml — flash 常驻书名头', () => {
  const withBook: BodyData = {
    ...flashData,
    segments: [
      { seqNo: 1, startMs: 0, endMs: 4000, subtitle: '今天分享的是', imageIndex: 0, bookTitle: '活着' },
      { seqNo: 2, startMs: 4000, endMs: 9000, subtitle: '正片一句', imageIndex: 1, bookTitle: '活着',
        captionBeats: [{ zh: '正片一句', startMs: 4000, endMs: 9000 }] },
    ],
  }
  const html = renderIndexHtml(withBook)
  it('正片段带 bookTitle → 渲染常驻《书名》头', () => {
    expect(html).toContain('class="book-header')
    expect(html).toContain('《活着》')
  })
  it('书名头在正片开始(flashEnd)后淡入,不早于快闪窗口', () => {
    // flashEnd = seg0.endMs = 4s；书名头 fromTo 起点应 >= 4
    expect(html).toMatch(/\.bh1'[^\n]*opacity: 1[^\n]*, 4\)/)
  })
})
