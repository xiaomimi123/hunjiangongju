import { describe, it, expect } from 'vitest'
import { countChars, validateScript, deriveCharBudget, trimToBudget } from './scriptPolicy'

describe('trimToBudget', () => {
  it('按整行丢弃末尾使其落在字数预算内', () => {
    const out = trimToBudget(['一二三四五', '六七八九十', '十一十二十三'], 21, 10)
    expect(out).toEqual(['一二三四五', '六七八九十'])
  })
  it('遵守行数上限', () => {
    expect(trimToBudget(['a', 'b', 'c', 'd'], 2, 999)).toEqual(['a', 'b'])
  })
  it('首行即超预算则截断首行,至少留一行', () => {
    const out = trimToBudget(['这是一句非常非常长的话'], 21, 5)
    expect(out.length).toBe(1)
    expect(Array.from(out[0]).length).toBe(5)
  })
})

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

describe('deriveCharBudget', () => {
  it('段数多时字数上限随之提高，保证每段够写', () => {
    const { maxTotalChars, maxLines } = deriveCharBudget(11, 0)
    expect(maxTotalChars).toBeGreaterThanOrEqual(11 * 8) // 每段至少 8 字余量
    expect(maxLines).toBeGreaterThanOrEqual(11)
  })
  it('封顶 600', () => {
    expect(deriveCharBudget(60, 5000).maxTotalChars).toBeLessThanOrEqual(600)
  })
  it('少段数不至过小', () => {
    expect(deriveCharBudget(3, 0).maxTotalChars).toBeGreaterThanOrEqual(3 * 8)
  })
})
