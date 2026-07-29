import { describe, it, expect } from 'vitest'
import { isVolcano, buildVolcanoBody, parseVolcanoAudio } from './volcanoTts'
describe('isVolcano', () => {
  it('按 openspeech 域名识别', () => {
    expect(isVolcano('https://openspeech.bytedance.com/api/v3/tts/unidirectional')).toBe(true)
    expect(isVolcano('https://dashscope.aliyuncs.com/x')).toBe(false)
  })
})
describe('buildVolcanoBody', () => {
  it('含 text/speaker/audio_params;无情感时不带 additions', () => {
    const b = buildVolcanoBody('你好', 'zh_female_x') as any
    expect(b.req_params.text).toBe('你好')
    expect(b.req_params.speaker).toBe('zh_female_x')
    expect(b.req_params.audio_params.format).toBe('mp3')
    expect(b.req_params.additions).toBeUndefined()
  })
  it('有情感时 additions 为序列化 JSON 含 context_texts', () => {
    const b = buildVolcanoBody('你好', 'v', '用温柔治愈的语气') as any
    expect(typeof b.req_params.additions).toBe('string')
    expect(JSON.parse(b.req_params.additions).context_texts).toEqual(['用温柔治愈的语气'])
  })
})
describe('parseVolcanoAudio', () => {
  it('拼接 code===0 行的 base64,忽略结束行', () => {
    const a = Buffer.from('AA').toString('base64'), b = Buffer.from('BB').toString('base64')
    const nd = [JSON.stringify({code:0,data:a}), JSON.stringify({code:0,data:b}), JSON.stringify({code:20000000})].join('\n')
    expect(parseVolcanoAudio(nd).toString()).toBe('AABB')
  })
  it('无音频行 → 抛错', () => {
    expect(() => parseVolcanoAudio(JSON.stringify({code:20000000}))).toThrow()
  })
})
