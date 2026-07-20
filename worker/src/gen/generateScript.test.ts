import { describe, it, expect, beforeAll } from 'vitest'
import {
  buildScriptPrompt,
  resolveScriptMode,
  frameworkBooks,
  allocateBookIndexes,
  assignBooksToSegments,
  buildTranslatePrompt,
  translateLine,
} from './generateScript'

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

describe('allocateBookIndexes（纯函数：把段序号分配到书目下标，用于 books 模式落 bookTitle/bookAuthor）', () => {
  it('段数是书数整数倍时，逐段连续、均匀分配', () => {
    expect(allocateBookIndexes(6, 2)).toEqual([0, 0, 0, 1, 1, 1])
  })

  it('段数不能被书数整除时，前面的书多分配一段（余数前置）', () => {
    expect(allocateBookIndexes(5, 2)).toEqual([0, 0, 0, 1, 1])
  })

  it('书数为 0（subject 模式或空书单）时，全部返回 -1（无归属）', () => {
    expect(allocateBookIndexes(3, 0)).toEqual([-1, -1, -1])
  })

  it('段数少于书数时，靠后的书分不到段', () => {
    expect(allocateBookIndexes(2, 3)).toEqual([0, 1])
  })
})

describe('assignBooksToSegments（纯函数：把 LLM 产出的分段文案按序归属到书目）', () => {
  const books = [
    { title: '活下去的理由', author: '马特·海格' },
    { title: '百年孤独', author: '加西亚·马尔克斯' },
  ]

  it('按分配把 bookTitle/bookAuthor 落到每段，且不改动 scriptText', () => {
    const lines = ['第一句', '第二句', '第三句', '第四句']
    expect(assignBooksToSegments(lines, books)).toEqual([
      { scriptText: '第一句', bookTitle: '活下去的理由', bookAuthor: '马特·海格' },
      { scriptText: '第二句', bookTitle: '活下去的理由', bookAuthor: '马特·海格' },
      { scriptText: '第三句', bookTitle: '百年孤独', bookAuthor: '加西亚·马尔克斯' },
      { scriptText: '第四句', bookTitle: '百年孤独', bookAuthor: '加西亚·马尔克斯' },
    ])
  })

  it('书目无 author 时，段落也不带 bookAuthor 字段', () => {
    expect(assignBooksToSegments(['句子'], [{ title: '孤独六讲' }])).toEqual([
      { scriptText: '句子', bookTitle: '孤独六讲' },
    ])
  })

  it('books 为空数组（subject 模式）时，段落不带 bookTitle/bookAuthor', () => {
    expect(assignBooksToSegments(['句子1', '句子2'], [])).toEqual([
      { scriptText: '句子1' },
      { scriptText: '句子2' },
    ])
  })
})

describe('buildTranslatePrompt（纯函数：中英字幕翻译 prompt）', () => {
  it('包含中文原句，且指示"只输出英文"', () => {
    const prompt = buildTranslatePrompt('这是一句测试文案。')
    expect(prompt).toContain('这是一句测试文案。')
    expect(prompt).toContain('只输出英文')
  })
})

describe('translateLine（mock 模式：不得走通用 llm mock，需返回自带定长占位英文）', () => {
  beforeAll(() => {
    process.env.AI_MOCK = '1'
  })

  it('mock 模式下返回固定占位英文字幕（非空、非中文）', async () => {
    const en = await translateLine('这是一句需要翻译的中文文案。')
    expect(en.length).toBeGreaterThan(0)
    expect(/[一-龥]/.test(en)).toBe(false)
  })
})

describe('frameworkBooks', () => {
  it('从 overlayTemplate.books 读出书目', () => {
    expect(frameworkBooks({ watermark: '@x', books: [{ title: '活下去的理由', author: '马特·海格' }] })).toEqual([
      { title: '活下去的理由', author: '马特·海格' },
    ])
  })
  it('无 books / 非法 → 空', () => {
    expect(frameworkBooks({ watermark: '@x' })).toEqual([])
    expect(frameworkBooks(null)).toEqual([])
    expect(frameworkBooks({ books: 'x' })).toEqual([])
  })
})
