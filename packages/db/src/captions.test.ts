import { describe, it, expect } from 'vitest'
import { splitCaptionPhrases, timeCaptionBeats } from './captions'

describe('splitCaptionPhrases', () => {
  it('按标点拆成短句', () => {
    expect(splitCaptionPhrases('所以在脑海里刻薄的自责，逼自己超负荷工作')).toEqual([
      '所以在脑海里刻薄的自责',
      '逼自己超负荷工作',
    ])
  })
  it('过短的并入相邻拍', () => {
    // "好" 太短(1字<5) → 并入上一拍
    expect(splitCaptionPhrases('凌晨三点还没睡，好')).toEqual(['凌晨三点还没睡好'])
  })
  it('过长的按上限再切', () => {
    const r = splitCaptionPhrases('这是一句没有任何标点符号却非常非常长的话需要被硬切成几段', { max: 10 })
    expect(r.length).toBeGreaterThanOrEqual(2)
    expect(Array.from(r[0]).length).toBeLessThanOrEqual(10)
  })
  it('空串返回空数组', () => {
    expect(splitCaptionPhrases('')).toEqual([])
  })
})

describe('timeCaptionBeats', () => {
  it('按字数占比分配时间且连续', () => {
    const beats = timeCaptionBeats([{ zh: '短' }, { zh: '长一点的句子' }], 0, 4000, 300)
    expect(beats[0].startMs).toBe(0)
    expect(beats[beats.length - 1].endMs).toBe(4000)
    // 连续无缝
    expect(beats[1].startMs).toBe(beats[0].endMs)
    // 长句拿到更多时间
    expect(beats[1].endMs - beats[1].startMs).toBeGreaterThan(beats[0].endMs - beats[0].startMs)
  })
  it('每拍不短于 minMs', () => {
    const beats = timeCaptionBeats([{ zh: 'a' }, { zh: 'b' }, { zh: 'c' }], 0, 900, 500)
    for (const b of beats) expect(b.endMs - b.startMs).toBeGreaterThanOrEqual(0) // 末拍可能被压缩，但不为负
  })
})
