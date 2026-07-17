import { describe, it, expect } from 'vitest'
import {
  estimateDurationMs, checkSubtitleOverflow,
  msToSrtTime, buildSrt, DIMS,
} from './pipeline'

describe('estimateDurationMs 语速估时', () => {
  it('12 个字 ÷ 6字/秒 = 2000ms', () => {
    expect(estimateDurationMs('一二三四五六七八九十一二')).toBe(2000)
  })
  it('短文本保底 1500ms', () => {
    expect(estimateDurationMs('好')).toBe(1500)
  })
})

describe('checkSubtitleOverflow 字幕越界', () => {
  it('语速在阈值内不越界', () => {
    expect(checkSubtitleOverflow('一二三四五六', 1000)).toBe(false) // 6字/秒
  })
  it('明显超速判越界', () => {
    expect(checkSubtitleOverflow('一二三四五六七八九十', 1000)).toBe(true) // 10字/秒
  })
})

describe('SRT 生成', () => {
  it('毫秒转 SRT 时间戳', () => {
    expect(msToSrtTime(3661234)).toBe('01:01:01,234')
    expect(msToSrtTime(0)).toBe('00:00:00,000')
  })
  it('拼装 SRT 块', () => {
    const srt = buildSrt([
      { text: '你好', startMs: 0, endMs: 1500 },
      { text: '世界', startMs: 1500, endMs: 3000 },
    ])
    expect(srt).toBe(
      '1\n00:00:00,000 --> 00:00:01,500\n你好\n\n2\n00:00:01,500 --> 00:00:03,000\n世界\n'
    )
  })
})

describe('输出规格', () => {
  it('两种规格分辨率', () => {
    expect(DIMS['9:16']).toEqual({ w: 1080, h: 1920 })
    expect(DIMS['16:9']).toEqual({ w: 1920, h: 1080 })
  })
})
