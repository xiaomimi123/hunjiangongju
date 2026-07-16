import { describe, it, expect } from 'vitest'
import { parseSilence, buildSpeech, coalesce, buildTimings, evenSplit } from './silence'

// 模拟 ffmpeg silencedetect 的组合输出（秒），4 段 speech：
// 0-1.5（口播标题，会被 skipLeading 跳过）、2-4、4.5-6.5、7-9.5
const SILENCEDETECT_OUTPUT = `
[silencedetect @ 0x7f] silence_start: 1.5
[silencedetect @ 0x7f] silence_end: 2 | silence_duration: 0.5
[silencedetect @ 0x7f] silence_start: 4
[silencedetect @ 0x7f] silence_end: 4.5 | silence_duration: 0.5
[silencedetect @ 0x7f] silence_start: 6.5
[silencedetect @ 0x7f] silence_end: 7 | silence_duration: 0.5
[silencedetect @ 0x7f] silence_start: 9.5
[silencedetect @ 0x7f] silence_end: 10 | silence_duration: 0.5
`
const DURATION_MS = 10000

describe('silence 主路径（silencedetect → body_timings）', () => {
  it('构造输出 + duration + N=3 → 3 段单调递增 {seqNo,startMs,endMs}', () => {
    const N = 3
    const skipLeading = 1
    const events = parseSilence(SILENCEDETECT_OUTPUT)
    expect(events).toHaveLength(8)

    const speech = buildSpeech(DURATION_MS, events)
    expect(speech).toEqual([
      { startMs: 0, endMs: 1500 },
      { startMs: 2000, endMs: 4000 },
      { startMs: 4500, endMs: 6500 },
      { startMs: 7000, endMs: 9500 },
    ])

    const merged = coalesce(speech, N + skipLeading)
    const timings = buildTimings(N, merged, skipLeading)

    expect(timings).toEqual([
      { seqNo: 1, startMs: 2000, endMs: 4000 },
      { seqNo: 2, startMs: 4500, endMs: 6500 },
      { seqNo: 3, startMs: 7000, endMs: 9500 },
    ])
    // 单调递增
    for (let i = 0; i < timings.length; i++) {
      expect(timings[i].endMs).toBeGreaterThan(timings[i].startMs)
      if (i > 0) expect(timings[i].startMs).toBeGreaterThanOrEqual(timings[i - 1].endMs)
    }
  })

  it('coalesce 把过多段贪心合并到 target', () => {
    const many = [
      { startMs: 0, endMs: 100 },
      { startMs: 120, endMs: 200 }, // gap 20 —— 最小，先合并
      { startMs: 600, endMs: 800 },
    ]
    const merged = coalesce(many, 2)
    expect(merged).toEqual([
      { startMs: 0, endMs: 200 },
      { startMs: 600, endMs: 800 },
    ])
  })

  it('段数不符时 buildTimings 抛错（触发兜底）', () => {
    const speech = buildSpeech(DURATION_MS, parseSilence(SILENCEDETECT_OUTPUT))
    // 只有 4 段，slice(1, 1+5) 得 3 段 ≠ 5
    expect(() => buildTimings(5, speech, 1)).toThrow(/mismatch/)
  })

  it('drop <80ms 的碎段', () => {
    const out = `
[silencedetect] silence_start: 0.05
[silencedetect] silence_end: 0.1
`
    // speech: 0-0.05（50ms，丢弃）、0.1-duration
    const speech = buildSpeech(1000, parseSilence(out))
    expect(speech).toEqual([{ startMs: 100, endMs: 1000 }])
  })
})

describe('silence 兜底路径（evenSplit 均分）', () => {
  it('evenSplit 产出 N 个等宽连续窗口，完整覆盖时长', () => {
    const N = 3
    const dur = 9000
    const windows = evenSplit(dur, N)
    expect(windows).toEqual([
      { seqNo: 1, startMs: 0, endMs: 3000 },
      { seqNo: 2, startMs: 3000, endMs: 6000 },
      { seqNo: 3, startMs: 6000, endMs: 9000 },
    ])
    // 连续无缝、覆盖 [0, dur]
    expect(windows[0].startMs).toBe(0)
    expect(windows[windows.length - 1].endMs).toBe(dur)
    for (let i = 1; i < windows.length; i++) {
      expect(windows[i].startMs).toBe(windows[i - 1].endMs)
    }
  })
})
