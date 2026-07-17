import { describe, it, expect } from 'vitest'
import { buildDashTtsBody } from './tts'

describe('buildDashTtsBody（DashScope TTS 请求体构造，纯函数）', () => {
  it('有 voiceId 时，无论 model 是否属于 CosyVoice 族，input.voice 都必须是克隆音色 voiceId（回归：qwen-tts 曾被静默丢弃）', () => {
    const body = buildDashTtsBody('qwen-tts', '你好', 'v-cloned-123', undefined)
    expect(body).toEqual({ model: 'qwen-tts', input: { text: '你好', voice: 'v-cloned-123' } })
  })

  it('cosyvoice 模型 + voiceId 同样直接使用 voiceId', () => {
    const body = buildDashTtsBody('cosyvoice-v1', '你好', 'v-cloned-456', undefined)
    expect(body).toEqual({ model: 'cosyvoice-v1', input: { text: '你好', voice: 'v-cloned-456' } })
  })

  it('无 voiceId 时使用显式指定的 voice', () => {
    const body = buildDashTtsBody('qwen-tts', '你好', undefined, 'Ethan')
    expect(body).toEqual({ model: 'qwen-tts', input: { text: '你好', voice: 'Ethan' } })
  })

  it('既无 voiceId 也无显式 voice 时回退默认 Cherry', () => {
    const body = buildDashTtsBody('qwen-tts', '你好', undefined, undefined)
    expect(body).toEqual({ model: 'qwen-tts', input: { text: '你好', voice: 'Cherry' } })
  })
})
