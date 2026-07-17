import { describe, it, expect } from 'vitest'
import { derivePace, applyPace, computeSegmentPads } from './pace'

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

describe('computeSegmentPads（每段 pad = pacedDur − origDur，用于音频感知 re-timing 插入静音）', () => {
  it('逐段算出 pad，且 sum(origDur)+sum(pad) == 总 paced 时长（音画同步的核心不变量）', () => {
    const orig = [
      { seqNo: 1, startMs: 0, endMs: 1500 }, // 1500ms
      { seqNo: 2, startMs: 1500, endMs: 3500 }, // 2000ms
    ]
    const paced = applyPace(orig, { avgSegMs: 4000 })
    const pads = computeSegmentPads(orig, paced)

    expect(pads).toHaveLength(2)
    pads.forEach((p, i) => {
      const origDur = orig[i].endMs - orig[i].startMs
      const pacedDur = paced[i].endMs - paced[i].startMs
      expect(p).toBe(pacedDur - origDur)
    })

    const sumOrigDur = orig.reduce((s, t) => s + (t.endMs - t.startMs), 0)
    const sumPad = pads.reduce((s, p) => s + p, 0)
    const totalPaced = paced[paced.length - 1].endMs - paced[0].startMs
    expect(sumOrigDur + sumPad).toBe(totalPaced)
  })

  it('pad 恒 clamp 到 >=0（即便传入一个比原时长还短的 paced 段，也不产生负 pad）', () => {
    const orig = [{ seqNo: 1, startMs: 0, endMs: 5000 }]
    const paced = [{ seqNo: 1, startMs: 0, endMs: 3000 }] // 人为构造：比 orig 短
    const pads = computeSegmentPads(orig, paced)
    expect(pads).toEqual([0])
  })

  it('无 pace（applyPace 原样返回）时，pads 全为 0', () => {
    const orig = [
      { seqNo: 1, startMs: 0, endMs: 2000 },
      { seqNo: 2, startMs: 2000, endMs: 5000 },
    ]
    const paced = applyPace(orig, { avgSegMs: 0 })
    const pads = computeSegmentPads(orig, paced)
    expect(pads).toEqual([0, 0])
  })

  it('origTimings[0].startMs=T0>0（alignCaptions 用 SKIP_LEADING=1 跳过开头标题段后，'
    + 'body 首段 startMs 是 T0 而非 0）：applyPace 保留 T0 作为首段 startMs，'
    + '且不变量要对齐「视频时间线」而非「首段起点」——'
    + 're-timed 音频总时长 T0+sum(pad_i)+sum(origDur_i) 必须等于视频总时长 max(paced endMs)。'
    + '这是本轮修复要保证的关键点：之前 retimeAudio 会把这段 [0,T0) 的标题音频丢弃，'
    + '导致重拼后的音频整体提前 T0 且总时长少 T0，被 renderVideo 的 -shortest 截断尾部。', () => {
    const T0 = 3200 // 开头标题段（未纳入 body 分段）时长
    const orig = [
      { seqNo: 1, startMs: T0, endMs: T0 + 1000 }, // 1000ms
      { seqNo: 2, startMs: T0 + 1000, endMs: T0 + 1800 }, // 800ms
    ]
    const paced = applyPace(orig, { avgSegMs: 4000 })
    const pads = computeSegmentPads(orig, paced)

    // 首段起点保留为 T0（不归零）——这正是 bug 的根源：retimeAudio 若只按 origTimings atrim，
    // 会从 T0 开始切，丢掉 [0,T0) 的标题音频
    expect(paced[0].startMs).toBe(T0)
    expect(orig[0].startMs).toBe(T0)

    // 视频时间线总时长 = max(paced endMs)（body.mp4 data-duration 用的就是这个）
    const videoDurationMs = paced[paced.length - 1].endMs

    // re-timed 音频若按本次修复「补回 [0,T0) 标题段 + 逐段 atrim+apad」，
    // 其总时长应为 T0 + sum(origDur_i + pad_i)，且必须等于视频总时长（消除 T0 偏移与截尾的核心断言）
    const sumOrigDur = orig.reduce((s, t) => s + (t.endMs - t.startMs), 0)
    const sumPad = pads.reduce((s, p) => s + p, 0)
    const retimedAudioTotalMs = T0 + sumOrigDur + sumPad
    expect(retimedAudioTotalMs).toBe(videoDurationMs)

    // 旧 bug 的证据：若像修复前那样从 origTimings[0].startMs(=T0) 开始 atrim（丢弃 [0,T0)），
    // 重拼总时长只有 sumOrigDur+sumPad，比视频时间线短 T0 —— 这正是尾部被 -shortest 截断的量
    const buggyRetimedTotalMs = sumOrigDur + sumPad
    expect(videoDurationMs - buggyRetimedTotalMs).toBe(T0)
  })
})
