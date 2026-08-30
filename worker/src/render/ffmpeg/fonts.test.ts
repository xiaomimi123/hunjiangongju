import { describe, it, expect } from 'vitest'
import { DEFAULT_FONT_ID } from '@mixcut/db'
import { usedBuiltinFontIds } from './fonts'

describe('usedBuiltinFontIds', () => {
  it('空输入：只含默认字体', () => {
    expect(usedBuiltinFontIds([])).toEqual([DEFAULT_FONT_ID])
    expect(usedBuiltinFontIds([undefined, undefined])).toEqual([DEFAULT_FONT_ID])
  })

  it('认不出的 id 被丢弃，不抛错', () => {
    expect(usedBuiltinFontIds(['nope', undefined])).toEqual([DEFAULT_FONT_ID])
  })

  it('重复 id 去重', () => {
    const out = usedBuiltinFontIds([DEFAULT_FONT_ID, DEFAULT_FONT_ID])
    expect(out).toEqual([DEFAULT_FONT_ID])
  })

  it('认得出的 id 保留在结果里，且默认字体仍在（正文字幕的回退落点）', () => {
    // 目前内置字体表只有默认字体这一条；这条断言按「认得出就保留」的语义写，
    // 不依赖表里有第二款字体——下一批任务加字体后这条不用改也该继续绿。
    const out = usedBuiltinFontIds([DEFAULT_FONT_ID])
    expect(out).toContain(DEFAULT_FONT_ID)
    expect(new Set(out).size).toBe(out.length)
  })
})
