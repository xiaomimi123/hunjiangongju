import { describe, it, expect } from 'vitest'
import { isVolcano, buildVolcanoBody, buildVolcanoHeaders, parseVolcanoCreate } from './volcanoTts'

describe('isVolcano', () => {
  it('按 openspeech 域名识别', () => {
    expect(isVolcano('https://openspeech.bytedance.com/api/v3/tts/create')).toBe(true)
    expect(isVolcano('https://dashscope.aliyuncs.com/x')).toBe(false)
  })
})

describe('buildVolcanoBody', () => {
  it('含 model/text_prompt/references/audio_config;无情感时 text_prompt 即原文', () => {
    const b = buildVolcanoBody('你好', 'zh_female_x') as any
    expect(b.model).toBe('seed-audio-1.0')
    expect(b.text_prompt).toBe('你好')
    expect(b.references).toEqual([{ speaker: 'zh_female_x' }])
    expect(b.audio_config.format).toBe('mp3')
    expect(b.audio_config.sample_rate).toBe(24000)
  })
  it('有情感时以自然语言前置到 text_prompt', () => {
    const b = buildVolcanoBody('你好', 'v', { emotionText: '用温柔治愈的语气' }) as any
    expect(b.text_prompt).toBe('（用温柔治愈的语气）你好')
  })
  it('model/sampleRate 可覆盖', () => {
    const b = buildVolcanoBody('你好', 'v', { model: 'seed-audio-1.0-multilingual', sampleRate: 48000 }) as any
    expect(b.model).toBe('seed-audio-1.0-multilingual')
    expect(b.audio_config.sample_rate).toBe(48000)
  })
})

describe('buildVolcanoHeaders', () => {
  it('无 appId → 新版单头 X-Api-Key', () => {
    const h = buildVolcanoHeaders('k1')
    expect(h['X-Api-Key']).toBe('k1')
    expect(h['X-Api-App-Id']).toBeUndefined()
    expect(h['X-Api-Access-Key']).toBeUndefined()
  })
  it('有 appId → 旧版双头,apiKey 作 Access-Key,不带 X-Api-Key', () => {
    const h = buildVolcanoHeaders('token1', 'app123')
    expect(h['X-Api-App-Id']).toBe('app123')
    expect(h['X-Api-Access-Key']).toBe('token1')
    expect(h['X-Api-Key']).toBeUndefined()
  })
})

describe('parseVolcanoCreate', () => {
  it('audio(base64) → 解码为 Buffer', () => {
    const audio = Buffer.from('AABB').toString('base64')
    const r = parseVolcanoCreate({ audio })
    expect(r.audio?.toString()).toBe('AABB')
    expect(r.url).toBeUndefined()
  })
  it('只有 url → 返回 url 待下载', () => {
    const r = parseVolcanoCreate({ duration: 82.8, url: 'https://x/a.mp3' })
    expect(r.url).toBe('https://x/a.mp3')
    expect(r.audio).toBeUndefined()
  })
  it('非0 code → 抛错(含 code 与 message)', () => {
    expect(() => parseVolcanoCreate({ code: 45000010, message: 'Invalid X-Api-Key' })).toThrow(/45000010/)
    expect(() => parseVolcanoCreate({ code: 45000010, message: 'Invalid X-Api-Key' })).toThrow(/Invalid X-Api-Key/)
  })
  it('既无 audio 也无 url → 抛错', () => {
    expect(() => parseVolcanoCreate({ duration: 0 })).toThrow()
  })
})
