// 剪辑节奏对齐（书单号 M2 Task4）：纯函数，确定性、可单测，不依赖 ffmpeg/LLM。
// derivePace：从源视频 ASR 句时间戳（+ 场景切点）反推源的平均段/镜头时长。
// applyPace：把 TTS 实测时长朝源节奏拉，但绝不短于该段 TTS 实测时长（否则截断音频）。

export type SentenceSpan = { startMs: number; endMs: number }
export type PaceInfo = { avgSegMs: number; segCount: number }
export type PaceTiming = { seqNo: number; startMs: number; endMs: number }

/** 每段最小可读时长（ms）：即便源节奏很快，也不把目标段压到不可读 */
const MIN_READABLE_MS = 1200

/** 向源节奏拉拢的混合权重：0=完全保留 TTS 实测时长，1=完全套用源均值 */
const PACE_BLEND_WEIGHT = 0.5

/**
 * 从源视频的 ASR 句时间戳 + 场景切点反推源节奏（平均段时长、段数）。
 * - 主信号：句时间戳（endMs-startMs 的均值）。
 * - 若场景切点比句子更细（数量更多），改用切点间隔均值（更贴近真实运镜节奏）。
 * - 本地 ASR 若只有占位/零时间戳（真实句级时间戳需异步 paraformer-v2），
 *   过滤掉 endMs<=startMs 的无效句 → 全部无效时优雅降级为 {avgSegMs:0, segCount:0}，
 *   调用方（applyPace）据此判定「无源节奏」，保留 TTS 原时序。
 */
export function derivePace(sentences: SentenceSpan[], cutPointsMs: number[]): PaceInfo {
  const valid = (sentences ?? []).filter((s) => Number.isFinite(s.startMs) && Number.isFinite(s.endMs) && s.endMs > s.startMs)
  if (valid.length === 0) return { avgSegMs: 0, segCount: 0 }

  const sentenceAvg = valid.reduce((sum, s) => sum + (s.endMs - s.startMs), 0) / valid.length

  let avgSegMs = sentenceAvg
  const cuts = Array.isArray(cutPointsMs) ? cutPointsMs : []
  if (cuts.length >= 2 && cuts.length > valid.length) {
    const sorted = [...cuts].sort((a, b) => a - b)
    const gaps: number[] = []
    for (let i = 1; i < sorted.length; i++) {
      const gap = sorted[i] - sorted[i - 1]
      if (gap > 0) gaps.push(gap)
    }
    if (gaps.length > 0) avgSegMs = gaps.reduce((a, b) => a + b, 0) / gaps.length
  }

  return { avgSegMs: Math.round(avgSegMs), segCount: valid.length }
}

/**
 * 把 TTS 实测时长（ttsTimings）朝源节奏 pace.avgSegMs 折中，重算连续的 startMs/endMs。
 * - pace.avgSegMs<=0（无源节奏，如本地占位时间戳）→ 原样返回，不做任何调整。
 * - 每段目标时长 = TTS 实测时长与 pace.avgSegMs 的加权混合，
 *   但下限永远是 max(MIN_READABLE_MS, 该段 TTS 实测时长) —— 保证音频不被截断。
 * - 各段首尾相接（下一段 startMs = 上一段 endMs），首段 startMs 保持不变。
 */
export function applyPace(ttsTimings: PaceTiming[], pace: { avgSegMs: number }): PaceTiming[] {
  if (!pace || pace.avgSegMs <= 0 || !ttsTimings || ttsTimings.length === 0) return ttsTimings

  let cursor = ttsTimings[0].startMs
  return ttsTimings.map((t) => {
    const ttsMs = Math.max(0, t.endMs - t.startMs)
    const floor = Math.max(MIN_READABLE_MS, ttsMs)
    const blended = ttsMs + (pace.avgSegMs - ttsMs) * PACE_BLEND_WEIGHT
    const durationMs = Math.max(floor, Math.round(blended))

    const startMs = cursor
    const endMs = startMs + durationMs
    cursor = endMs
    return { seqNo: t.seqNo, startMs, endMs }
  })
}

/**
 * 每段 pad（ms）= paced 时长 − 原始（TTS 实测）时长，逐段按数组下标对齐（两数组同序同长）。
 * clamp 到 >=0：`applyPace` 已保证 pacedDur >= origDur，这里再兜底一次防御性 clamp。
 *
 * 用途：音频感知 re-timing —— 对每段原始音频切片末尾补 pad_i 毫秒静音，使新音频总时长
 * 与 paced 视觉总时长一致（`sum(origDur) + sum(pad) == 总 paced 时长`），从而消除音画脱轨。
 */
export function computeSegmentPads(origTimings: PaceTiming[], pacedTimings: PaceTiming[]): number[] {
  return origTimings.map((orig, i) => {
    const pacedT = pacedTimings[i]
    if (!pacedT) return 0
    const origDur = orig.endMs - orig.startMs
    const pacedDur = pacedT.endMs - pacedT.startMs
    return Math.max(0, pacedDur - origDur)
  })
}
