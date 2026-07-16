import { describe, it, expect } from 'vitest'
import { countChars, validateScript } from './scriptPolicy'

describe('scriptPolicy', () => {
  it('countChars 按 code point 计 CJK 字数', () => {
    // 5 个中文字符（含标点）应记为 5，而非 UTF-16 长度
    expect(countChars(['你好', '世界！'])).toBe(5)
    // emoji 是单一 code point（Array.from 正确处理代理对）
    expect(countChars(['🚀'])).toBe(1)
  })

  it('干净文案通过校验，无 errors', () => {
    const r = validateScript(['第一行', '第二行', '  第三行  '])
    expect(r.errors).toEqual([])
    expect(r.lines).toBe(3)
    expect(r.chars).toBe(9)
    expect(r.clean).toEqual(['第一行', '第二行', '第三行'])
  })

  it('空行/纯空白行被 trim 过滤，不计入', () => {
    const r = validateScript(['一', '', '   ', '二'])
    expect(r.lines).toBe(2)
    expect(r.clean).toEqual(['一', '二'])
  })

  it('超行时报错', () => {
    const lines = Array.from({ length: 4 }, (_, i) => `行${i}`)
    const r = validateScript(lines, 3, 220)
    expect(r.errors.some((e) => e.includes('最多 3 行'))).toBe(true)
  })

  it('超字时报错', () => {
    const r = validateScript(['一二三四五六'], 21, 5)
    expect(r.errors.some((e) => e.includes('最多 5 字'))).toBe(true)
  })
})
