import { describe, it, expect } from 'vitest'
import { HttpError } from './auth'
import { validateInputs } from './cozeToolAdmin'

describe('validateInputs', () => {
  const validImage = { name: 'cover', label: '封面图', type: 'image', required: false }
  const validText = { name: 'topic', label: '主题', type: 'text', required: true }

  it('合法 inputs → 通过', () => {
    const r = validateInputs([validText, validImage])
    expect(r).toHaveLength(2)
  })

  it('两项同 name（一个 image 一个 text）→ 400，指明第几项与第几项重复', () => {
    try {
      validateInputs([validImage, { name: 'cover', label: '封面文字', type: 'text', required: false }])
      expect.unreachable()
    } catch (e) {
      expect(e).toBeInstanceOf(HttpError)
      expect((e as HttpError).status).toBe(400)
      expect((e as HttpError).message).toBe('第 2 项与第 1 项参数名重复')
    }
  })

  it('三项，第 3 项与第 1 项重名 → 报第 3 项与第 1 项', () => {
    try {
      validateInputs([
        validText,
        { name: 'other', label: '其它', type: 'text', required: false },
        { name: 'topic', label: '重名主题', type: 'image', required: false },
      ])
      expect.unreachable()
    } catch (e) {
      expect((e as HttpError).message).toBe('第 3 项与第 1 项参数名重复')
    }
  })

  it('inputs 不是数组 → 400', () => {
    expect(() => validateInputs('nope')).toThrow(HttpError)
  })

  it('name 不合法 → 400', () => {
    expect(() => validateInputs([{ name: '带 空格', label: 'x', type: 'text', required: false }])).toThrow(HttpError)
  })

  it('select 缺 options → 400', () => {
    expect(() => validateInputs([{ name: 'x', label: 'x', type: 'select', required: false }])).toThrow(HttpError)
  })
})
