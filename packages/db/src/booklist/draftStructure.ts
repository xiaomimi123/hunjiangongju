// 从主视频轨（attribute===1）的段落节奏切出 开场/快闪/正片 三段结构。
// 依据（双样本实测）：首段=开场；紧随其后连续 <500ms 的最长连跑=快闪；余下=正片。
// 比「靠《书名》文字段推快闪」稳——空白模板没有书名文字也能切对。

const FLASH_MAX_MS = 500

export interface DraftStructure {
  openDurationMs: number
  flashCount: number
  flashPerClipMs: number
  flashMinClipMs: number
  bodyCount: number
  bodyAvgMs: number
  flashScale: number
  bodyScale: number
  segments: { index: number; role: 'open' | 'flash' | 'body'; durationMs: number; scale: number }[]
}

function obj(x: unknown): Record<string, unknown> {
  return x && typeof x === 'object' && !Array.isArray(x) ? (x as Record<string, unknown>) : {}
}
function arr(x: unknown): unknown[] {
  return Array.isArray(x) ? x : []
}
function median(xs: number[]): number {
  if (xs.length === 0) return 1
  const s = [...xs].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}
function avg(xs: number[]): number {
  return xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : 0
}

const EMPTY: DraftStructure = {
  openDurationMs: 0, flashCount: 0, flashPerClipMs: 0, flashMinClipMs: 0,
  bodyCount: 0, bodyAvgMs: 0, flashScale: 1, bodyScale: 1, segments: [],
}

export function extractDraftStructure(draft: unknown): DraftStructure {
  try {
    const tracks = arr(obj(draft).tracks).map(obj)
    const main = tracks.find((t) => t.type === 'video' && t.attribute === 1) ?? tracks.find((t) => t.type === 'video')
    if (!main) return EMPTY
    const segs = arr(main.segments).map(obj).map((s) => {
      const tt = obj(s.target_timerange)
      const scale = obj(obj(s.clip).scale).x
      return {
        durationMs: typeof tt.duration === 'number' ? Math.round(tt.duration / 1000) : 0,
        scale: typeof scale === 'number' && scale > 0 ? scale : 1,
      }
    })
    if (segs.length === 0) return EMPTY

    // 首段=开场；从第 1 段起找最长的「连续短段」连跑=快闪；其余=正片
    let bestStart = -1, bestLen = 0
    let i = 1
    while (i < segs.length) {
      if (segs[i].durationMs > 0 && segs[i].durationMs < FLASH_MAX_MS) {
        let j = i
        while (j < segs.length && segs[j].durationMs > 0 && segs[j].durationMs < FLASH_MAX_MS) j++
        if (j - i > bestLen) { bestLen = j - i; bestStart = i }
        i = j
      } else i++
    }
    const roles: ('open' | 'flash' | 'body')[] = segs.map((_, k) =>
      k === 0 ? 'open' : bestLen > 0 && k >= bestStart && k < bestStart + bestLen ? 'flash' : 'body')

    const flashDurs = segs.filter((_, k) => roles[k] === 'flash').map((s) => s.durationMs)
    const bodyDurs = segs.filter((_, k) => roles[k] === 'body').map((s) => s.durationMs)
    return {
      openDurationMs: segs[0].durationMs,
      flashCount: flashDurs.length,
      flashPerClipMs: avg(flashDurs),
      flashMinClipMs: flashDurs.length ? Math.min(...flashDurs) : 0,
      bodyCount: bodyDurs.length,
      bodyAvgMs: avg(bodyDurs),
      flashScale: median(segs.filter((_, k) => roles[k] === 'flash').map((s) => s.scale)),
      bodyScale: median(segs.filter((_, k) => roles[k] === 'body').map((s) => s.scale)),
      segments: segs.map((s, k) => ({ index: k, role: roles[k], durationMs: s.durationMs, scale: s.scale })),
    }
  } catch {
    return EMPTY
  }
}
