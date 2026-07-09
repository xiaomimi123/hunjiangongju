export const CHARS_PER_SEC = 6
export const MIN_SEGMENT_MS = 1500
const OVERFLOW_TOLERANCE = 0.5

export const DIMS: Record<'9:16' | '16:9', { w: number; h: number }> = {
  '9:16': { w: 1080, h: 1920 },
  '16:9': { w: 1920, h: 1080 },
}

export function splitScript(content: string): string[] {
  return content.split(/\r?\n+/).map((s) => s.trim()).filter(Boolean)
}

export function scoreMaterial(segTagIds: string[], matTagIds: string[]): number {
  const set = new Set(matTagIds)
  return segTagIds.filter((id) => set.has(id)).length
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

export const TRANSITIONS: Record<string, string[]> = {
  CREATED: ['SEGMENTING'],
  SEGMENTING: ['MATCHING', 'FAILED'],
  MATCHING: ['MATERIAL_PENDING', 'STORYBOARD_READY', 'FAILED'],
  MATERIAL_PENDING: ['MATCHING'],
  STORYBOARD_READY: ['RENDERING', 'FAILED'],
  RENDERING: ['PREVIEW_PENDING', 'FAILED'],
  PREVIEW_PENDING: ['REVISING', 'QC_RUNNING'],
  REVISING: ['RENDERING'],
  QC_RUNNING: ['QC_PASSED', 'QC_FAILED', 'FAILED'],
  QC_FAILED: ['REVISING', 'QC_RUNNING'],
  QC_PASSED: ['EXPORTED', 'FAILED'],
  EXPORTED: [],
  FAILED: ['SEGMENTING'],
}

export function canTransition(from: string, to: string): boolean {
  return (TRANSITIONS[from] ?? []).includes(to)
}
