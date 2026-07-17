import { describe, it, expect } from 'vitest'
import { buildScriptPrompt, resolveScriptMode } from './generateScript'

describe('buildScriptPrompt', () => {
  const framework = { frameworkText: '开头钩子+逐段展开，语气亲切', segCount: 6, maxLines: 20, maxTotalChars: 200 }

  it('books 模式：包含书名、作者、要点，逐句/书评指令，以及字数行数上限', () => {
    const prompt = buildScriptPrompt({
      mode: 'books',
      subject: '不重要（书单模式忽略选题）',
      books: [
        { title: '活下去的理由', author: '马特·海格', points: '走出抑郁的真实故事' },
        { title: '百年孤独', author: '加西亚·马尔克斯' },
      ],
      framework,
    })
    expect(prompt).toContain('活下去的理由')
    expect(prompt).toContain('马特·海格')
    expect(prompt).toContain('走出抑郁的真实故事')
    expect(prompt).toContain('百年孤独')
    expect(prompt).toContain('加西亚·马尔克斯')
    expect(prompt).toContain('逐句')
    expect(prompt).toContain('书评')
    expect(prompt).toContain('200 字')
    expect(prompt).toContain('20 行')
  })

  it('books 模式：单本书无 author/points 时不报错，仍产出合法 prompt', () => {
    const prompt = buildScriptPrompt({
      mode: 'books',
      subject: '不重要',
      books: [{ title: '孤独六讲' }],
      framework,
    })
    expect(prompt).toContain('孤独六讲')
    expect(prompt).toContain('逐句')
  })

  it('subject 模式：指示先选书再写，且不预先给出具体书单', () => {
    const prompt = buildScriptPrompt({
      mode: 'subject',
      subject: '如何走出低谷期',
      framework,
    })
    expect(prompt).toContain('先选书')
    expect(prompt).toContain('如何走出低谷期')
    expect(prompt).toContain('6 段')
    expect(prompt).toContain('200 字')
    expect(prompt).toContain('20 行')
  })
})

describe('resolveScriptMode', () => {
  it('variables.books 为非空数组 → books 模式，透传 books', () => {
    const r = resolveScriptMode({ books: [{ title: 'A' }] })
    expect(r.mode).toBe('books')
    expect(r.books).toEqual([{ title: 'A' }])
  })

  it('variables 为 null/空对象/空数组 → subject 模式', () => {
    expect(resolveScriptMode(null).mode).toBe('subject')
    expect(resolveScriptMode(undefined).mode).toBe('subject')
    expect(resolveScriptMode({}).mode).toBe('subject')
    expect(resolveScriptMode({ books: [] }).mode).toBe('subject')
  })

  it('variables.books 存在但非数组 → subject 模式（防御非法输入）', () => {
    expect(resolveScriptMode({ books: '不是数组' }).mode).toBe('subject')
  })
})
