import { describe, it, expect } from 'vitest'
import { readVoiceId } from './generateTts'

describe('readVoiceId', () => {
  it('variables.voiceId 为非空字符串 → 原样返回（去除首尾空白）', () => {
    expect(readVoiceId({ voiceId: 'cosyvoice-v3-plus-abc123 ' })).toBe('cosyvoice-v3-plus-abc123')
  })

  it('未选音色（variables 为 null/undefined/空对象）→ undefined，保持通用音色行为不变', () => {
    expect(readVoiceId(null)).toBeUndefined()
    expect(readVoiceId(undefined)).toBeUndefined()
    expect(readVoiceId({})).toBeUndefined()
  })

  it('variables.voiceId 为空字符串/非字符串/variables 非对象 → undefined（防御非法输入）', () => {
    expect(readVoiceId({ voiceId: '' })).toBeUndefined()
    expect(readVoiceId({ voiceId: '   ' })).toBeUndefined()
    expect(readVoiceId({ voiceId: 123 })).toBeUndefined()
    expect(readVoiceId('not-an-object')).toBeUndefined()
    expect(readVoiceId(['array'])).toBeUndefined()
  })

  it('variables 含其余字段（如 books）时仍能取出 voiceId', () => {
    expect(readVoiceId({ books: [{ title: 'A' }], voiceId: 'v-1' })).toBe('v-1')
  })
})
