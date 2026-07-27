import { describe, it, expect } from 'vitest'
import { readScriptMode, readCustomScript, readBookTitle } from './generateScript'
import { splitScriptToSegments } from './splitScript'

describe('readScriptMode/CustomScript/BookTitle', () => {
  it('manual/imitate 识别；其余 auto', () => {
    expect(readScriptMode({ scriptMode: 'manual' })).toBe('manual')
    expect(readScriptMode({ scriptMode: 'imitate' })).toBe('imitate')
    expect(readScriptMode({ scriptMode: 'weird' })).toBe('auto')
    expect(readScriptMode(null)).toBe('auto')
    expect(readScriptMode({})).toBe('auto')
  })
  it('customScript/bookTitle 读取', () => {
    expect(readCustomScript({ customScript: '句一。句二。' })).toBe('句一。句二。')
    expect(readCustomScript({})).toBe('')
    expect(readBookTitle({ bookTitle: '活着' })).toBe('活着')
    expect(readBookTitle({})).toBeUndefined()
  })
  it('manual 切分数 = 分镜数', () => {
    expect(splitScriptToSegments(readCustomScript({ customScript: '一。二。三。' })).length).toBe(3)
  })
})

import { booksForAssign } from './generateScript'

describe('booksForAssign（manual/imitate 不吃框架书目位置分配）', () => {
  const books = [{ title: '活着' }, { title: '兄弟' }]
  it('auto → 原样透传书单（走位置分配《书名》头）', () => {
    expect(booksForAssign('auto', books)).toEqual(books)
  })
  it('manual/imitate → 空数组（不按框架书目分配，避免手动稿出现错乱书名头）', () => {
    expect(booksForAssign('manual', books)).toEqual([])
    expect(booksForAssign('imitate', books)).toEqual([])
  })
  it('books 缺省 → []', () => {
    expect(booksForAssign('auto', undefined)).toEqual([])
  })
})
