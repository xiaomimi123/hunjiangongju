import { describe, it, expect } from 'vitest'
import { readVoiceId, parseBeats, readVoice } from './generateTts'

describe('parseBeats（逐段配音的朗读文本来源）', () => {
  it('正常节拍 → 按序取出 zh，并保留 en', () => {
    expect(
      parseBeats([{ zh: '第一句', en: 'first' }, { zh: '第二句' }], '整段兜底'),
    ).toEqual([{ zh: '第一句', en: 'first' }, { zh: '第二句' }])
  })

  it('zh 首尾空白被去除；en 为空字符串时不落 en 字段', () => {
    expect(parseBeats([{ zh: '  有空白  ', en: '   ' }], '兜底')).toEqual([{ zh: '有空白' }])
  })

  it('captionBeats 缺失/非数组/空数组 → 回退整段 scriptText，保证该段仍有一次配音', () => {
    expect(parseBeats(undefined, '整段文案')).toEqual([{ zh: '整段文案' }])
    expect(parseBeats(null, '整段文案')).toEqual([{ zh: '整段文案' }])
    expect(parseBeats('not-an-array', '整段文案')).toEqual([{ zh: '整段文案' }])
    expect(parseBeats([], '整段文案')).toEqual([{ zh: '整段文案' }])
  })

  it('混入脏节拍（zh 非字符串/空串/null）→ 过滤掉，只保留合法句', () => {
    expect(
      parseBeats([{ zh: '' }, { zh: 123 }, null, { en: 'no-zh' }, { zh: '唯一合法' }], '兜底'),
    ).toEqual([{ zh: '唯一合法' }])
  })

  it('全部节拍都是脏数据 → 整体回退 scriptText（而非产出空数组）', () => {
    expect(parseBeats([{ zh: '   ' }, { zh: null }], '整段文案')).toEqual([{ zh: '整段文案' }])
  })
})

describe('readVoiceId', () => {
  it('variables.voiceId 为非空字符串 → 原样返回（去除首尾空白）', () => {
    expect(readVoiceId({ voiceId: 'cosyvoice-v3-plus-abc123 ' })).toBe('cosyvoice-v3-plus-abc123')
  })

  it('未选音色（variables 为 null/undefined/空对象）→ undefined，保持通用音色行为不变', () => {
    expect(readVoiceId(null)).toBeUndefined()
    expect(readVoiceId(undefined)).toBeUndefined()
    expect(readVoiceId({})).toBeUndefined()
  })

  it('variables.voiceId 为空字符串/非字符串/variables 非对象 → undefined（防御非法输入）', () => {
    expect(readVoiceId({ voiceId: '' })).toBeUndefined()
    expect(readVoiceId({ voiceId: '   ' })).toBeUndefined()
    expect(readVoiceId({ voiceId: 123 })).toBeUndefined()
    expect(readVoiceId('not-an-object')).toBeUndefined()
    expect(readVoiceId(['array'])).toBeUndefined()
  })

  it('variables 含其余字段（如 books）时仍能取出 voiceId', () => {
    expect(readVoiceId({ books: [{ title: 'A' }], voiceId: 'v-1' })).toBe('v-1')
  })
})

describe('readVoice', () => {
  it('白名单内的 voice 原样返回，否则 undefined', () => {
    expect(readVoice({ voice: 'zh_female_vv_uranus_bigtts' })).toBe('zh_female_vv_uranus_bigtts')
    expect(readVoice({ voice: '乱填' })).toBeUndefined()
    expect(readVoice({})).toBeUndefined()
    expect(readVoice(null)).toBeUndefined()
  })

  it('形如合法音色 id（如火山克隆 S_ 开头）即便不在内置白名单也放行', () => {
    expect(readVoice({ voice: 'S_abc123' })).toBe('S_abc123')
  })

  it('格式不合法（含空格/过短）仍拒绝', () => {
    expect(readVoice({ voice: '乱 填' })).toBeUndefined()
    expect(readVoice({ voice: 'ab' })).toBeUndefined()
  })
})
