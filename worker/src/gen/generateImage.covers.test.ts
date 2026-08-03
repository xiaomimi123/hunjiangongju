import { describe, it, expect } from 'vitest'
import { resolveBooks, DEFAULT_IMAGE_STYLE } from './generateImage'

describe('DEFAULT_IMAGE_STYLE', () => {
  it('导出非空的厚涂油画默认画风兜底文案', () => {
    expect(DEFAULT_IMAGE_STYLE).toBeTruthy()
    expect(DEFAULT_IMAGE_STYLE).toContain('厚涂油画')
  })
})

describe('resolveBooks', () => {
  it('优先 overlayTemplate.books', () => {
    expect(resolveBooks({ books: [{ title: '活着', author: '余华' }] }, { books: [{ title: 'X' }] }))
      .toEqual([{ title: '活着', author: '余华' }])
  })
  it('overlayTemplate 无 → 回退 variables.books', () => {
    expect(resolveBooks({}, { books: [{ title: 'A' }] })).toEqual([{ title: 'A' }])
  })
  it('过滤无 title 的脏项；都没有 → []', () => {
    expect(resolveBooks({ books: [{ title: '' }, { author: 'x' }, { title: 'B' }] }, {})).toEqual([{ title: 'B' }])
    expect(resolveBooks({}, {})).toEqual([])
  })
})
