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
