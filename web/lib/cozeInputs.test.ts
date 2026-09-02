import { describe, it, expect } from 'vitest'
import { HttpError } from './auth'
import { validateInputsAgainst } from './cozeInputs'

describe('validateInputsAgainst', () => {
  const declared = [
    { name: 'input_text', label: '原文', type: 'text' as const, required: true },
    { name: 'style', label: '风格', type: 'select' as const, options: ['活泼', '严肃'], required: false },
    { name: 'cover', label: '封面图', type: 'image' as const, required: false },
  ]

  it('必填缺失 → 400 指明哪项', () => {
    try {
      validateInputsAgainst(declared, {})
      expect.unreachable()
    } catch (e) {
      expect(e).toBeInstanceOf(HttpError)
      expect((e as HttpError).status).toBe(400)
      expect((e as HttpError).message).toContain('原文')
    }
  })

  // ★ 必填校验不能被对象绕过：{} 不是 undefined/null/''，如果 text 分支把它静默转成 ''
  // 再走 empty 判定，required 就形同虚设——学员传个空对象就能骗过校验，白扣分建 run。
  it('必填 text 传对象 {} → 400（不能被转空串绕过必填）', () => {
    expect(() => validateInputsAgainst(declared, { input_text: {} })).toThrow(HttpError)
    try {
      validateInputsAgainst(declared, { input_text: {} })
    } catch (e) {
      expect((e as HttpError).status).toBe(400)
    }
  })

  it('必填 text 传数组 [] → 400', () => {
    expect(() => validateInputsAgainst(declared, { input_text: [] })).toThrow(HttpError)
  })

  it('select 值不在 options 内 → 400', () => {
    expect(() => validateInputsAgainst(declared, { input_text: 'x', style: '奇怪' })).toThrow(HttpError)
  })

  it('select 值合法 → 通过', () => {
    const r = validateInputsAgainst(declared, { input_text: 'x', style: '活泼' })
    expect(r.style).toBe('活泼')
  })

  it('image 值路径穿越 → 400', () => {
    expect(() => validateInputsAgainst(declared, { input_text: 'x', cover: '../../etc/passwd' })).toThrow(HttpError)
  })

  it('image 值不带 coze-uploads/ 前缀 → 400', () => {
    expect(() =>
      validateInputsAgainst(declared, { input_text: 'x', cover: '11111111-1111-1111-1111-111111111111.png' }),
    ).toThrow(HttpError)
  })

  it('image 值合法 → 通过', () => {
    const r = validateInputsAgainst(declared, {
      input_text: 'x',
      cover: 'coze-uploads/11111111-1111-1111-1111-111111111111.png',
    })
    expect(r.cover).toBe('coze-uploads/11111111-1111-1111-1111-111111111111.png')
  })

  it('未声明的多余字段丢弃不报错', () => {
    const r = validateInputsAgainst(declared, { input_text: 'x', extra_junk: 'whatever' })
    expect(r).not.toHaveProperty('extra_junk')
  })

  it('text 超长截断到 5000 字符', () => {
    const long = 'a'.repeat(6000)
    const r = validateInputsAgainst(declared, { input_text: long })
    expect((r.input_text as string).length).toBe(5000)
  })
})
