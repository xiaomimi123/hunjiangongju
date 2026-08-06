import { describe, it, expect } from 'vitest'
import { looksLikePlainJsonHead } from './draftText'

describe('looksLikePlainJsonHead', () => {
  it('普通明文 JSON → true', () => {
    expect(looksLikePlainJsonHead('{"a":1}')).toBe(true)
  })
  it('带 UTF-8 BOM 的明文 JSON → true', () => {
    expect(looksLikePlainJsonHead(String.fromCharCode(0xfeff) + '{"a":1}')).toBe(true)
  })
  it('前导空白后是 { → true', () => {
    expect(looksLikePlainJsonHead('\n\t {"a":1}')).toBe(true)
  })
  it('密文（不以 { 开头）→ false', () => {
    expect(looksLikePlainJsonHead('U2FsdGVkX1+abc123==')).toBe(false)
  })
  it('空字符串 → false', () => {
    expect(looksLikePlainJsonHead('')).toBe(false)
  })
})
