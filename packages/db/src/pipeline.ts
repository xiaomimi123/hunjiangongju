export const CHARS_PER_SEC = 6
export const MIN_SEGMENT_MS = 1500
const OVERFLOW_TOLERANCE = 0.5

export const DIMS: Record<'9:16' | '16:9', { w: number; h: number }> = {
  '9:16': { w: 1080, h: 1920 },
  '16:9': { w: 1920, h: 1080 },
}

export function estimateDurationMs(text: string): number {
  return Math.max(MIN_SEGMENT_MS, Math.ceil((text.length / CHARS_PER_SEC) * 1000))
}

export function checkSubtitleOverflow(text: string, durationMs: number): boolean {
  if (durationMs <= 0) return true
  return text.length / (durationMs / 1000) > CHARS_PER_SEC + OVERFLOW_TOLERANCE
}

export function msToSrtTime(ms: number): string {
  const pad = (n: number, w = 2) => String(n).padStart(w, '0')
  const h = Math.floor(ms / 3_600_000)
  const m = Math.floor(ms / 60_000) % 60
  const s = Math.floor(ms / 1000) % 60
  return `${pad(h)}:${pad(m)}:${pad(s)},${pad(ms % 1000, 3)}`
}

export function buildSrt(items: { text: string; startMs: number; endMs: number }[]): string {
  return items
    .map((it, i) => `${i + 1}\n${msToSrtTime(it.startMs)} --> ${msToSrtTime(it.endMs)}\n${it.text}\n`)
    .join('\n')
}
