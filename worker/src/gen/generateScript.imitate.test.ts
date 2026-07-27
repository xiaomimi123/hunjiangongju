import { describe, it, expect } from 'vitest'
import { buildImitatePrompt } from './generateScript'

const fw = { frameworkText: '框架说明', segCount: 6, maxLines: 21, maxTotalChars: 220 }

describe('buildImitatePrompt', () => {
  const p = buildImitatePrompt({ reference: '一生中与你相处时间最长的就是你自己。', subject: '自我接纳', framework: fw })
  it('包含参考文案与"仿写/模仿"指令', () => {
    expect(p).toContain('一生中与你相处时间最长的就是你自己')
    expect(p).toMatch(/仿写|模仿|照.*风格/)
  })
  it('要求原创改写、不照抄参考', () => {
    expect(p).toMatch(/不.*照抄|原创改写/)
  })
  it('带字数/行数预算与风格准则(无CTA)', () => {
    expect(p).toContain('220')
    expect(p).toContain('21')
    expect(p).toMatch(/CTA|购物车|关注/) // STYLE_RULES 里的禁 CTA 条款
  })
})
