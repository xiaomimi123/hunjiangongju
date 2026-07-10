import { describe, it, expect } from 'vitest'
import { isEmail, genCode, hashCode } from './authcodes'

describe('邮箱校验', () => {
  it('合法邮箱', () => { expect(isEmail('a@b.com')).toBe(true) })
  it('非法邮箱', () => {
    expect(isEmail('a@b')).toBe(false)
    expect(isEmail('nope')).toBe(false)
    expect(isEmail('a b@c.com')).toBe(false)
  })
})
describe('验证码', () => {
  it('genCode 为 6 位数字', () => { expect(genCode()).toMatch(/^\d{6}$/) })
  it('hashCode 稳定且非明文', () => {
    expect(hashCode('123456')).toBe(hashCode('123456'))
    expect(hashCode('123456')).not.toContain('123456')
  })
})
