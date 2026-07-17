import { describe, it, expect, beforeAll } from 'vitest'
import { signAssetPath, verifyAssetToken } from './signedUrl'

beforeAll(() => { process.env.ASSET_URL_SECRET = 'test-secret' })

describe('signed asset url', () => {
  it('签发的 token 在有效期内可验证', () => {
    const now = 1_000_000
    const tok = signAssetPath('gen/a/final.mp4', 600, now)
    expect(verifyAssetToken('gen/a/final.mp4', tok, now + 10_000)).toBe(true)
  })
  it('过期失败', () => {
    const now = 1_000_000
    const tok = signAssetPath('gen/a/final.mp4', 1, now)
    expect(verifyAssetToken('gen/a/final.mp4', tok, now + 5_000)).toBe(false)
  })
  it('路径不符失败（防越权）', () => {
    const now = 1_000_000
    const tok = signAssetPath('gen/a/final.mp4', 600, now)
    expect(verifyAssetToken('gen/b/other.mp4', tok, now + 1000)).toBe(false)
  })
})
