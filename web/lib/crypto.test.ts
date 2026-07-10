import { describe, it, expect } from 'vitest'
import { encrypt, decrypt } from './crypto'

describe('AES 加解密', () => {
  it('round-trip 还原原文', () => {
    const s = 'super-secret-smtp-pass-你好'
    expect(decrypt(encrypt(s))).toBe(s)
  })
  it('相同明文两次密文不同（随机 IV）', () => {
    expect(encrypt('x')).not.toBe(encrypt('x'))
  })
  it('空串解密返回空串', () => {
    expect(decrypt('')).toBe('')
  })
})
