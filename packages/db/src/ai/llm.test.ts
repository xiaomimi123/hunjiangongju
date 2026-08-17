import { describe, it, expect } from 'vitest'
import { buildLlmBody } from './llm'

const cfg = { model: 'qwen-plus' } as never

describe('buildLlmBody', () => {
  it('缺省不带 temperature 与 enable_search（保持现状默认）', () => {
    const b = buildLlmBody(cfg, { prompt: 'x' })
    expect('temperature' in b).toBe(false)
    expect('enable_search' in b).toBe(false)
    expect(b.max_tokens).toBe(2000)
  })
  it('传 temperature → 顶层带上', () => {
    expect(buildLlmBody(cfg, { prompt: 'x', temperature: 0.9 }).temperature).toBe(0.9)
  })
  it('enableSearch=true → 顶层 enable_search:true', () => {
    expect(buildLlmBody(cfg, { prompt: 'x', enableSearch: true }).enable_search).toBe(true)
  })
  it('enableSearch=false → 不带该字段（不发 false，避免覆盖服务端默认）', () => {
    expect('enable_search' in buildLlmBody(cfg, { prompt: 'x', enableSearch: false })).toBe(false)
  })
  it('system 存在时 messages 首条为 system', () => {
    const b = buildLlmBody(cfg, { prompt: 'p', system: 's' })
    expect(b.messages[0]).toEqual({ role: 'system', content: 's' })
  })
})
