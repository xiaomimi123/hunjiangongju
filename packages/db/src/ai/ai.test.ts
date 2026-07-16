import { describe, it, expect, beforeAll } from 'vitest'
import { llmComplete, imageGenerate, ttsSynthesize, asrTranscribe } from '.'

beforeAll(() => { process.env.AI_MOCK = '1' })

describe('AI 适配层 mock', () => {
  it('llm 返回非空文案', async () => {
    const t = await llmComplete({ prompt: 'x' })
    expect(t.length).toBeGreaterThan(0)
    expect(t.split('\n').length).toBeGreaterThanOrEqual(3)
  })
  it('image 返回合法 PNG 头', async () => {
    const b = await imageGenerate({ prompt: 'x' })
    expect(b.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a')
  })
  it('tts 返回 WAV 头', async () => {
    const b = await ttsSynthesize({ text: '你好' })
    expect(b.subarray(0, 4).toString('ascii')).toBe('RIFF')
    expect(b.subarray(8, 12).toString('ascii')).toBe('WAVE')
  })
  it('asr 返回全文与分句', async () => {
    const r = await asrTranscribe({ audioPath: '/nonexistent-in-mock.wav' })
    expect(r.fullText.length).toBeGreaterThan(0)
    expect(r.sentences.length).toBe(3)
    expect(r.sentences[0]).toHaveProperty('startMs')
  })
})
