import { describe, it, expect } from 'vitest'
import { TTS_VOICES, isValidVoice } from './ttsVoices'

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
