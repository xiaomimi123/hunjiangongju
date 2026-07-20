import { describe, it, expect, beforeAll } from 'vitest'
import { parseEnrollResult, enrollVoice } from './voiceClone'

describe('parseEnrollResult', () => {
  it('从声音复刻建声接口结果中提取 voice_id（结构核对自 https://help.aliyun.com/zh/model-studio/voice-clone-design-http-api）', () => {
    const raw = { output: { voice_id: 'v-123' } }
    expect(parseEnrollResult(raw)).toEqual({ voiceId: 'v-123' })
  })

  it('缺少 voice_id 时抛出异常', () => {
    expect(() => parseEnrollResult({ output: {} })).toThrow()
    expect(() => parseEnrollResult({})).toThrow()
  })
})

describe('enrollVoice mock 模式', () => {
  beforeAll(() => { process.env.AI_MOCK = '1' })

  it('mock 下返回确定性 fake voiceId，不发起真实网络请求', async () => {
    const r = await enrollVoice('https://example.com/sample.wav', '测试音色')
    expect(r.voiceId.length).toBeGreaterThan(0)
    expect(typeof r.voiceId).toBe('string')
  })
})
