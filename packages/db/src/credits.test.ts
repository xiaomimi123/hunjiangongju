import { describe, it, expect } from 'vitest'
import { formatCredits, creditsToCc } from './credits'

describe('formatCredits（cc → 展示）', () => {
  it.each([
    [300, '3.00'], [100, '1.00'], [8, '0.08'], [150, '1.50'], [10, '0.10'], [123, '1.23'], [0, '0.00'], [3000, '30.00'],
  ])('%i cc → %s', (cc, out) => {
    expect(formatCredits(cc)).toBe(out)
  })
})

describe('creditsToCc（积分输入 → cc）', () => {
  it('合法：整数/两位小数/字符串数字', () => {
    expect(creditsToCc(1)).toBe(100)
    expect(creditsToCc(0.08)).toBe(8)
    expect(creditsToCc('0.5')).toBe(50)
    expect(creditsToCc(0)).toBe(0)
  })
  it('非法：负数/三位小数/NaN/非数字', () => {
    expect(creditsToCc(-1)).toBeNull()
    expect(creditsToCc(0.001)).toBeNull()
    expect(creditsToCc('abc')).toBeNull()
    expect(creditsToCc(undefined)).toBeNull()
    expect(creditsToCc(2_000_000)).toBeNull()
  })
})
