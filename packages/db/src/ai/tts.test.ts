import { describe, it, expect, vi, beforeEach } from 'vitest'
import { buildDashTtsBody, ttsSynthesize } from './tts'

const mockGetCapabilityConfig = vi.fn()
vi.mock('./config', () => ({
  getCapabilityConfig: (...args: unknown[]) => mockGetCapabilityConfig(...args),
  isMockMode: () => false,
}))

const mockVolcanoTtsSynthesize = vi.fn()
vi.mock('./volcanoTts', async () => {
  const actual = await vi.importActual<typeof import('./volcanoTts')>('./volcanoTts')
  return { ...actual, volcanoTtsSynthesize: (...args: unknown[]) => mockVolcanoTtsSynthesize(...args) }
})

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

describe('ttsSynthesize / 火山克隆路由（speaker 以 S_ 开头 → seed-icl-2.0，无 context_texts）', () => {
  const volcanoBaseCfg = {
    capability: 'tts' as const,
    baseUrl: 'https://openspeech.bytedance.com/api/v3/tts/unidirectional',
    apiKey: 'k1',
    model: 'seed-tts-2.0',
    enabled: true,
  }

  beforeEach(() => {
    mockGetCapabilityConfig.mockReset()
    mockVolcanoTtsSynthesize.mockReset()
    mockVolcanoTtsSynthesize.mockResolvedValue(Buffer.from('audio'))
  })

  it('克隆音色 S_abc123 → resourceId=seed-icl-2.0，即便 extra.emotion 配了也 emotionText=undefined', async () => {
    mockGetCapabilityConfig.mockResolvedValue({ ...volcanoBaseCfg, extra: { emotion: '用温柔的语气' } })
    await ttsSynthesize({ text: '你好', voice: 'S_abc123' })
    expect(mockVolcanoTtsSynthesize).toHaveBeenCalledWith(
      expect.objectContaining({ speaker: 'S_abc123', resourceId: 'seed-icl-2.0', emotionText: undefined }),
    )
  })

  it('普通音色行为不变：resourceId 取 cfg.model，emotionText 取 extra.emotion', async () => {
    mockGetCapabilityConfig.mockResolvedValue({ ...volcanoBaseCfg, extra: { emotion: '用温柔的语气' } })
    await ttsSynthesize({ text: '你好', voice: 'zh_female_vv_uranus_bigtts' })
    expect(mockVolcanoTtsSynthesize).toHaveBeenCalledWith(
      expect.objectContaining({ speaker: 'zh_female_vv_uranus_bigtts', resourceId: 'seed-tts-2.0', emotionText: '用温柔的语气' }),
    )
  })

  it('extra.cloneResourceId 可覆盖克隆音色的默认 resourceId', async () => {
    mockGetCapabilityConfig.mockResolvedValue({ ...volcanoBaseCfg, extra: { cloneResourceId: 'seed-icl-custom' } })
    await ttsSynthesize({ text: '你好', voice: 'S_abc123' })
    expect(mockVolcanoTtsSynthesize).toHaveBeenCalledWith(
      expect.objectContaining({ resourceId: 'seed-icl-custom', emotionText: undefined }),
    )
  })
})
