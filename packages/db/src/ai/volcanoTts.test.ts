import { describe, it, expect } from 'vitest'
import { isVolcano, buildVolcanoBody, buildVolcanoHeaders, parseVolcanoStream } from './volcanoTts'

describe('isVolcano', () => {
  it('按 openspeech 域名识别', () => {
    expect(isVolcano('https://openspeech.bytedance.com/api/v3/tts/unidirectional')).toBe(true)
    expect(isVolcano('https://dashscope.aliyuncs.com/x')).toBe(false)
  })
})

describe('buildVolcanoBody', () => {
  it('req_params 含 text/speaker/audio_params;无情感不带 context_texts', () => {
    const b = buildVolcanoBody('你好', 'zh_female_vv_uranus_bigtts') as any
    expect(b.req_params.text).toBe('你好')
    expect(b.req_params.speaker).toBe('zh_female_vv_uranus_bigtts')
    expect(b.req_params.audio_params.format).toBe('mp3')
    expect(b.req_params.audio_params.sample_rate).toBe(24000)
    expect(b.req_params.context_texts).toBeUndefined()
    expect(b.user).toBeUndefined() // 该接口无 user 字段
  })
  it('有情感 → context_texts 为语音指令数组', () => {
    const b = buildVolcanoBody('你好', 'v', { emotionText: '用温柔治愈的语气' }) as any
    expect(b.req_params.context_texts).toEqual(['用温柔治愈的语气'])
  })
  it('sampleRate 可覆盖', () => {
    const b = buildVolcanoBody('你好', 'v', { sampleRate: 48000 }) as any
    expect(b.req_params.audio_params.sample_rate).toBe(48000)
  })
})

describe('buildVolcanoHeaders', () => {
  it('含 X-Api-Key / X-Api-Resource-Id / X-Api-Request-Id', () => {
    const h = buildVolcanoHeaders('k1', 'seed-tts-2.0', 'req-1')
    expect(h['X-Api-Key']).toBe('k1')
    expect(h['X-Api-Resource-Id']).toBe('seed-tts-2.0')
    expect(h['X-Api-Request-Id']).toBe('req-1')
  })
})

describe('parseVolcanoStream', () => {
  it('拼接多个 code:0 分片的 base64(NDJSON 分隔)', () => {
    const a = Buffer.from('AA').toString('base64'), b = Buffer.from('BB').toString('base64')
    const body = [JSON.stringify({ code: 0, data: a }), JSON.stringify({ code: 0, data: b, sentence: {} })].join('\n')
    expect(parseVolcanoStream(body).toString()).toBe('AABB')
  })
  it('无分隔拼接的对象也能切分', () => {
    const a = Buffer.from('AA').toString('base64'), b = Buffer.from('BB').toString('base64')
    const body = JSON.stringify({ code: 0, data: a }) + JSON.stringify({ code: 0, data: b })
    expect(parseVolcanoStream(body).toString()).toBe('AABB')
  })
  it('code 非 0 → 抛错(含 code 与 message)', () => {
    const body = JSON.stringify({ code: 45000010, message: 'Invalid X-Api-Key' })
    expect(() => parseVolcanoStream(body)).toThrow(/45000010/)
    expect(() => parseVolcanoStream(body)).toThrow(/Invalid X-Api-Key/)
  })
  it('已收集分片后遇到非 0 code → 立即抛错,不返回截断音频', () => {
    const a = Buffer.from('AA').toString('base64')
    const body = JSON.stringify({ code: 0, data: a }) + '\n' + JSON.stringify({ code: 55000031, message: 'quota' })
    expect(() => parseVolcanoStream(body)).toThrow(/55000031/)
  })
  it('无任何音频分片 → 抛错', () => {
    expect(() => parseVolcanoStream(JSON.stringify({ code: 0, sentence: {} }))).toThrow()
  })
})
