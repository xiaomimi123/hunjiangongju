// silencedetect → body_timings 纯算法（毫秒制，确定性、可单测，不依赖 ffmpeg）
// 参考 hyperframes-reuse-reference.md §3。本仓库 Prisma 存毫秒，故输出统一为整数 ms。

export type SilenceEvent = { type: 'start' | 'end'; timeMs: number }
export type Segment = { startMs: number; endMs: number }
export type Timing = { seqNo: number; startMs: number; endMs: number }

const MIN_SPEECH_MS = 80 // 丢弃 <0.08s 的碎段

// 步骤 4：正则抓 silence_start / silence_end（秒）→ 事件（ms）
export function parseSilence(output: string): SilenceEvent[] {
  const re = /silence_(start|end):\s*([0-9.]+)/g
  const events: SilenceEvent[] = []
  let m: RegExpExecArray | null
  while ((m = re.exec(output)) !== null) {
    events.push({ type: m[1] as 'start' | 'end', timeMs: parseFloat(m[2]) * 1000 })
  }
  return events
}

// 步骤 5：反转 silence → speech 段；丢弃 <80ms
export function buildSpeech(durationMs: number, events: SilenceEvent[]): Segment[] {
  const segs: Segment[] = []
  let speechStart = 0
  let inSilence = false
  for (const e of events) {
    if (e.type === 'start') {
      // 静音开始 → 当前 speech 段结束
      if (!inSilence && e.timeMs > speechStart) segs.push({ startMs: speechStart, endMs: e.timeMs })
      inSilence = true
    } else {
      // 静音结束 → speech 段开始
      speechStart = e.timeMs
      inSilence = false
    }
  }
  if (!inSilence && durationMs > speechStart) segs.push({ startMs: speechStart, endMs: durationMs })
  return segs.filter((s) => s.endMs - s.startMs >= MIN_SPEECH_MS)
}

// 步骤 6：贪心合并「间隔最小」的相邻段，直到剩 target 段
export function coalesce(segs: Segment[], target: number): Segment[] {
  const out = segs.map((s) => ({ ...s }))
  while (out.length > target && out.length > 1) {
    let minGap = Infinity
    let minIdx = 0
    for (let i = 0; i < out.length - 1; i++) {
      const gap = out[i + 1].startMs - out[i].endMs
      if (gap < minGap) {
        minGap = gap
        minIdx = i
      }
    }
    out[minIdx] = { startMs: out[minIdx].startMs, endMs: out[minIdx + 1].endMs }
    out.splice(minIdx + 1, 1)
  }
  return out
}

// 步骤 7：跳过开头 skipLeading 段（口播标题），取 n 段；数量不符抛错
export function buildTimings(n: number, segs: Segment[], skipLeading = 1): Timing[] {
  const selected = segs.slice(skipLeading, skipLeading + n)
  if (selected.length !== n) {
    throw new Error(
      `Speech segment count mismatch: 需要 ${n} 段，实得 ${selected.length}（调整 skipLeading 或 silence 参数）`,
    )
  }
  return selected.map((s, i) => ({
    seqNo: i + 1,
    startMs: Math.round(s.startMs),
    endMs: Math.round(s.endMs),
  }))
}

// 兜底：把总时长均分成 n 个连续等宽窗口（mock 全静音场景走此路径）
export function evenSplit(durationMs: number, n: number): Timing[] {
  const out: Timing[] = []
  for (let i = 0; i < n; i++) {
    out.push({
      seqNo: i + 1,
      startMs: Math.round((durationMs * i) / n),
      endMs: Math.round((durationMs * (i + 1)) / n),
    })
  }
  return out
}
