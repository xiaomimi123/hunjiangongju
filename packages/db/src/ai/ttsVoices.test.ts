import { describe, it, expect } from 'vitest'
import { TTS_VOICES, isValidVoice, isPlausibleVoiceId } from './ttsVoices'

describe('ttsVoices', () => {
  it('清单非空、每项有 id/label', () => {
    expect(TTS_VOICES.length).toBeGreaterThan(0)
    for (const v of TTS_VOICES) {
      expect(typeof v.id).toBe('string')
      expect(typeof v.label).toBe('string')
    }
  })
  it('isValidVoice 只认白名单', () => {
    expect(isValidVoice(TTS_VOICES[0].id)).toBe(true)
    expect(isValidVoice('不存在')).toBe(false)
    expect(isValidVoice(123)).toBe(false)
  })
})

describe('isPlausibleVoiceId', () => {
  it('字母数字._- 组成、3~64位 → 通过（含火山克隆 S_ 开头）', () => {
    expect(isPlausibleVoiceId('S_x9-K.z')).toBe(true)
    expect(isPlausibleVoiceId('S_abc123')).toBe(true)
    expect(isPlausibleVoiceId('a'.repeat(64))).toBe(true)
  })
  it('过短(<3)/含空格/含中文/超长(>64)/非字符串 → 拒', () => {
    expect(isPlausibleVoiceId('ab')).toBe(false)
    expect(isPlausibleVoiceId('a b')).toBe(false)
    expect(isPlausibleVoiceId('乱填')).toBe(false)
    expect(isPlausibleVoiceId('a'.repeat(65))).toBe(false)
    expect(isPlausibleVoiceId(123)).toBe(false)
    expect(isPlausibleVoiceId(undefined)).toBe(false)
  })
})
