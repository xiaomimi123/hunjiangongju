import { describe, it, expect } from 'vitest'
import { esc, sec } from './util'

describe('esc', () => {
  it('转义 HTML 特殊字符', () => {
    expect(esc('第一句 <字幕> & "x"')).toBe('第一句 &lt;字幕&gt; &amp; &quot;x&quot;')
  })
  it('null/undefined → 空串', () => {
    expect(esc(undefined as unknown as string)).toBe('')
    expect(esc(null as unknown as string)).toBe('')
  })
})

describe('sec', () => {
  it('毫秒转秒并保留 3 位小数', () => {
    expect(sec(4500)).toBe(4.5)
    expect(sec(2000)).toBe(2)
    expect(sec(1234)).toBe(1.234)
  })
})
