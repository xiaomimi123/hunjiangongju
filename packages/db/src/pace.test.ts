import { describe, it, expect } from 'vitest'
import { derivePace, applyPace } from './pace'

describe('derivePace（源节奏：句时间戳 + 场景切点 → avgSegMs/segCount）', () => {
  it('从句时间戳算出平均段时长与段数（无切点时）', () => {
    // 3 句：时长分别 2000ms / 3000ms / 4000ms → 平均 3000ms
    const sentences = [
      { startMs: 0, endMs: 2000 },
      { startMs: 2000, endMs: 5000 },
      { startMs: 5000, endMs: 9000 },
    ]
    const pace = derivePace(sentences, [])
    expect(pace).toEqual({ avgSegMs: 3000, segCount: 3 })
  })

  it('场景切点比句子更细时，用切点间隔均值代替句均值', () => {
    const sentences = [{ startMs: 0, endMs: 9000 }] // 单句，粗粒度
    // 6 个切点 → 5 个间隔：1000,1000,1000,1000,1000（比句均值 9000 更细）
    const cutPointsMs = [0, 1000, 2000, 3000, 4000, 5000]
    const pace = derivePace(sentences, cutPointsMs)
    expect(pace.avgSegMs).toBe(1000)
    expect(pace.segCount).toBe(1)
  })

  it('空句子输入 → 默认 {avgSegMs:0, segCount:0}', () => {
    expect(derivePace([], [])).toEqual({ avgSegMs: 0, segCount: 0 })
  })

  it('本地占位/零时间戳（真实句级时间戳需异步 paraformer-v2）→ 优雅降级为 0', () => {
    // 同步 ASR 兜底返回单句 {startMs:0, endMs:0}（见 packages/db/src/ai/asr.ts asrTranscribeSync）
    const sentences = [{ startMs: 0, endMs: 0 }]
    expect(derivePace(sentences, [])).toEqual({ avgSegMs: 0, segCount: 0 })
  })
})

describe('applyPace（TTS 实测时长 ↔ 源节奏 折中，保证不截断音频）', () => {
  it('avgSegMs<=0 → 原样返回（无源节奏则保留 TTS 时序）', () => {
    const tts = [
      { seqNo: 1, startMs: 0, endMs: 2000 },
      { seqNo: 2, startMs: 2000, endMs: 5000 },
    ]
    expect(applyPace(tts, { avgSegMs: 0 })).toEqual(tts)
    expect(applyPace(tts, { avgSegMs: -100 })).toEqual(tts)
  })

  it('过短的 TTS 段被拉长，向源均值靠拢，且保持连续（首段 start 不变，后段衔接前段 end）', () => {
    const tts = [
      { seqNo: 1, startMs: 0, endMs: 1500 }, // 1500ms，比源均值 4000 短很多
      { seqNo: 2, startMs: 1500, endMs: 3500 }, // 2000ms
    ]
    const result = applyPace(tts, { avgSegMs: 4000 })
    expect(result[0].startMs).toBe(0)
    // 拉向 4000：blend 后应比原 1500 更接近 4000，但不需等于 4000
    expect(result[0].endMs - result[0].startMs).toBeGreaterThan(1500)
    expect(result[1].startMs).toBe(result[0].endMs) // 连续：下一段起点=上一段终点
    expect(result[1].endMs).toBeGreaterThan(result[1].startMs)
  })

  it('过长的 TTS 段被压短，向源均值靠拢，但绝不短于该段 TTS 实测时长', () => {
    const tts = [{ seqNo: 1, startMs: 0, endMs: 8000 }] // 8000ms，远长于源均值 1000
    const result = applyPace(tts, { avgSegMs: 1000 })
    // 关键约束：源节奏再快，也不能短于 TTS 实测时长（否则截断音频）
    expect(result[0].endMs - result[0].startMs).toBeGreaterThanOrEqual(8000)
  })

  it('极短 TTS 段 + 极短源均值，仍不低于最小可读时长下限', () => {
    const tts = [{ seqNo: 1, startMs: 0, endMs: 500 }] // TTS 实测仅 500ms
    const result = applyPace(tts, { avgSegMs: 100 }) // 源均值更短
    const dur = result[0].endMs - result[0].startMs
    expect(dur).toBeGreaterThanOrEqual(500) // 不短于 TTS 实测
    expect(dur).toBeGreaterThanOrEqual(1200) // 且不低于最小可读时长
  })

  it('多段结果整体保持连续、seqNo 不变、顺序不变', () => {
    const tts = [
      { seqNo: 1, startMs: 0, endMs: 1000 },
      { seqNo: 2, startMs: 1000, endMs: 1800 },
      { seqNo: 3, startMs: 1800, endMs: 4000 },
    ]
    const result = applyPace(tts, { avgSegMs: 2000 })
    expect(result.map((r) => r.seqNo)).toEqual([1, 2, 3])
    for (let i = 1; i < result.length; i++) {
      expect(result[i].startMs).toBe(result[i - 1].endMs)
    }
  })
})
