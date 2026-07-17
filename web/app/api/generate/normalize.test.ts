import { describe, it, expect } from 'vitest'
import { normalizeVariables, normalizeBooks } from './normalize'

describe('normalizeVariables', () => {
  it('variables 为空/undefined → undefined', () => {
    expect(normalizeVariables(undefined)).toBeUndefined()
    expect(normalizeVariables(null)).toBeUndefined()
  })

  it('含合法 voiceId（可能带首尾空白）→ trim 后保留', () => {
    expect(normalizeVariables({ voiceId: ' cosyvoice-v3-plus-abc123 ' })).toEqual({ voiceId: 'cosyvoice-v3-plus-abc123' })
  })

  it('voiceId 为空字符串/纯空白 → 从结果中剔除（未选音色，走通用音色）', () => {
    expect(normalizeVariables({ voiceId: '' })).toEqual({})
    expect(normalizeVariables({ voiceId: '   ' })).toEqual({})
  })

  it('books 与 voiceId 同时存在 → 都正确处理', () => {
    const r = normalizeVariables({ books: [{ title: '活下去的理由' }], voiceId: 'v-1' })
    expect(r).toEqual({ books: [{ title: '活下去的理由' }], voiceId: 'v-1' })
  })

  it('顶层非对象或为数组 → 抛错', () => {
    expect(() => normalizeVariables('not-an-object')).toThrow()
    expect(() => normalizeVariables(['a'])).toThrow()
  })
})

describe('normalizeBooks', () => {
  it('过滤空书名行，保留 author/points', () => {
    const r = normalizeBooks([{ title: '活下去的理由', author: '马特·海格' }, { title: '' }])
    expect(r).toEqual([{ title: '活下去的理由', author: '马特·海格' }])
  })

  it('全部为空书名 → 抛错', () => {
    expect(() => normalizeBooks([{ title: '' }])).toThrow()
  })

  it('非数组输入 → 抛错', () => {
    expect(() => normalizeBooks('not-an-array')).toThrow()
  })
})
