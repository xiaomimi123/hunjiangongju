// 把一句口播文案拆成「字幕短句节拍」：按中文标点切，过短的并入相邻、过长的再切，
// 目标每拍 min~max 字。用于「图片停住、字幕短句快速跳」的书单号节奏。
export function splitCaptionPhrases(text: string, opts?: { min?: number; max?: number }): string[] {
  const min = opts?.min ?? 5
  const max = opts?.max ?? 16
  const clean = (text ?? '').trim()
  if (!clean) return []
  const len = (s: string) => Array.from(s).length

  const raw = clean.split(/[，。！？、；：,.!?;:…—\n]+/).map((s) => s.trim()).filter(Boolean)
  const out: string[] = []
  for (const p of raw) {
    if (len(p) > max) {
      // 过长：按 max 硬切
      const chars = Array.from(p)
      for (let i = 0; i < chars.length; i += max) out.push(chars.slice(i, i + max).join(''))
    } else if (out.length > 0 && len(out[out.length - 1]) < min) {
      // 上一拍过短 → 并入
      out[out.length - 1] += p
    } else {
      out.push(p)
    }
  }
  // 收尾：末拍过短则并入上一拍
  if (out.length >= 2 && len(out[out.length - 1]) < min) {
    out[out.length - 2] += out[out.length - 1]
    out.pop()
  }
  return out.length ? out : [clean]
}

export type CaptionBeat = { zh: string; en?: string }

// 把一段的时间窗 [startMs,endMs] 按各拍字数占比分配给字幕节拍，保证每拍不短于 minMs。
export function timeCaptionBeats(
  beats: CaptionBeat[],
  startMs: number,
  endMs: number,
  minMs = 700,
): { zh: string; en?: string; startMs: number; endMs: number }[] {
  if (beats.length === 0) return []
  const total = Math.max(1, endMs - startMs)
  const weights = beats.map((b) => Math.max(1, Array.from(b.zh).length))
  const sum = weights.reduce((a, w) => a + w, 0)
  let cursor = startMs
  return beats.map((b, i) => {
    const isLast = i === beats.length - 1
    let dur = isLast ? endMs - cursor : Math.round((total * weights[i]) / sum)
    dur = Math.max(minMs, dur)
    const s = cursor
    let e = Math.min(endMs, s + dur)
    if (isLast) e = endMs
    cursor = e
    return { zh: b.zh, ...(b.en ? { en: b.en } : {}), startMs: s, endMs: e }
  })
}
