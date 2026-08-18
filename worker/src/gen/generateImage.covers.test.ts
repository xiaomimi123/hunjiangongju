import { describe, it, expect } from 'vitest'
import { resolveBooks, DEFAULT_IMAGE_STYLE } from './generateImage'

describe('DEFAULT_IMAGE_STYLE', () => {
  it('导出非空的梵高后印象派默认画风兜底文案', () => {
    expect(DEFAULT_IMAGE_STYLE).toBeTruthy()
    expect(DEFAULT_IMAGE_STYLE).toContain('梵高')
    // 「无人物」是硬约束：书单号配图出现人脸会很违和,且与 negative_prompt 一致
    expect(DEFAULT_IMAGE_STYLE).toContain('无人物')
  })
})

describe('resolveBooks', () => {
  it('优先 variables.books', () => {
    expect(resolveBooks({ books: [{ title: '活着', author: '余华' }] }, { books: [{ title: 'X' }] }))
      .toEqual([{ title: 'X' }])
  })
  it('overlayTemplate 无 → 回退 variables.books', () => {
    expect(resolveBooks({}, { books: [{ title: 'A' }] })).toEqual([{ title: 'A' }])
  })
  it('过滤无 title 的脏项；都没有 → []', () => {
    expect(resolveBooks({ books: [{ title: '' }, { author: 'x' }, { title: 'B' }] }, {})).toEqual([{ title: 'B' }])
    expect(resolveBooks({}, {})).toEqual([])
  })
})

describe('resolveBooks —— variables.books 优先', () => {
  it('两者都有时用 variables.books（per-generation 比框架默认值更具体）', () => {
    const out = resolveBooks(
      { books: [{ title: '框架原书', author: '原作者' }] },
      { books: [{ title: '本次选书甲' }, { title: '本次主题书', author: '某作者' }] },
    )
    expect(out.map((b) => b.title)).toEqual(['本次选书甲', '本次主题书'])
  })

  it('variables.books 为空 → 回退框架书目', () => {
    expect(resolveBooks({ books: [{ title: '框架原书' }] }, { books: [] }).map((b) => b.title)).toEqual(['框架原书'])
    expect(resolveBooks({ books: [{ title: '框架原书' }] }, {}).map((b) => b.title)).toEqual(['框架原书'])
  })

  it('两者皆空 → 空数组', () => {
    expect(resolveBooks({}, {})).toEqual([])
  })

  it('脏项（无 title / title 空白）被过滤，顺序不变', () => {
    const out = resolveBooks({}, { books: [{ title: '甲' }, { title: '  ' }, { author: '无题' }, { title: '乙' }] })
    expect(out.map((b) => b.title)).toEqual(['甲', '乙'])
  })
})
