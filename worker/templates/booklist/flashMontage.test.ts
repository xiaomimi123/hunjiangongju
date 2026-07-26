import { describe, it, expect } from 'vitest'
import { openTitleHtml, openTitleTweens, flashCardsHtml, flashCardsTweens } from './flashMontage'

const covers = [
  { title: '活着', author: '余华', coverSrc: 'covers/01.png' },
  { title: '兄弟', coverSrc: 'covers/02.png' },
]
const tl = { openEndMs: 2000, flashEndMs: 4000, perClipMs: 1000, count: 2 }

describe('openTitle', () => {
  it('标题元素含文本、data-layout-ignore、转义', () => {
    expect(openTitleHtml('今天<x>')).toContain('class="flash-open" data-layout-ignore')
    expect(openTitleHtml('今天<x>')).toContain('今天&lt;x&gt;')
  })
  it('0s 淡入、openEndMs 前收起', () => {
    const t = openTitleTweens(2000)
    expect(t).toContain(', 0)')
    expect(t).not.toContain('function')
  })
})

describe('flashCards', () => {
  it('每本一卡：封面底图 + 叠书名(标题字体类)', () => {
    const h = flashCardsHtml(covers, 'flash-title')
    expect((h.match(/class="flashcard/g) ?? []).length).toBe(2)
    expect(h).toContain("covers/01.png")
    expect(h).toContain('活着')
    expect(h).toContain('flash-title') // 标题字体族类名
  })
  it('每卡在 openEndMs+k*perClipMs 处切入，位置字面量、不含 function', () => {
    const t = flashCardsTweens(covers, tl, true)
    expect(t).toContain(', 2)')  // 第0本 @ 2.0s
    expect(t).toContain(', 3)')  // 第1本 @ 3.0s
    expect(t).not.toContain('function')
    expect(t).not.toContain('=>')
  })
})
