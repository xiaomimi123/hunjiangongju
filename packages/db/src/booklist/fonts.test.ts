import { describe, it, expect } from 'vitest'
import { BUILTIN_FONTS, DEFAULT_FONT_ID, findBuiltinFont } from './fonts'

describe('字体注册表', () => {
  it('默认字体在表里，且族名是 Noto Sans SC', () => {
    const d = findBuiltinFont(DEFAULT_FONT_ID)
    expect(d).toBeDefined()
    expect(d!.family).toBe('Noto Sans SC')
    expect(d!.file).toBe('NotoSansSC-Regular.otf')
  })

  it('id 唯一', () => {
    const ids = BUILTIN_FONTS.map((f) => f.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('族名唯一 —— 两款字体同族名会让 ASS 的 Fontname 无法区分', () => {
    const fams = BUILTIN_FONTS.map((f) => f.family)
    expect(new Set(fams).size).toBe(fams.length)
  })

  it('认不出的 id 返回 undefined，不抛错', () => {
    expect(findBuiltinFont('nope')).toBeUndefined()
    expect(findBuiltinFont(undefined)).toBeUndefined()
  })
})
