// 剪映文字动画名 → 渲染层已有的字幕入场。只映射有对应关系的，其余不猜（返回 null 走轮换）。
export type EntranceId = 'fade-up' | 'mask-reveal' | 'char-stagger' | 'slide-in'

const RULES: [RegExp, EntranceId][] = [
  [/逐字/, 'char-stagger'],
  [/渐显|淡入/, 'fade-up'],
  [/点开|展开/, 'mask-reveal'],
  [/滑片|滑动|滑入/, 'slide-in'],
]

function obj(x: unknown): Record<string, unknown> {
  return x && typeof x === 'object' && !Array.isArray(x) ? (x as Record<string, unknown>) : {}
}
function arr(x: unknown): unknown[] {
  return Array.isArray(x) ? x : []
}

export function extractSubtitleEntrance(draft: unknown): EntranceId | null {
  const materials = obj(obj(draft).materials)
  const animsById = new Map<string, string[]>()
  for (const raw of arr(materials.material_animations)) {
    const ma = obj(raw)
    const id = typeof ma.id === 'string' ? ma.id : undefined
    if (!id) continue
    animsById.set(id, arr(ma.animations).map(obj).map((a) => (typeof a.name === 'string' ? a.name : '')).filter(Boolean))
  }
  const counts = new Map<EntranceId, number>()
  for (const rawTrack of arr(obj(draft).tracks)) {
    const track = obj(rawTrack)
    if (track.type !== 'text' && track.type !== 'sticker') continue
    for (const rawSeg of arr(track.segments)) {
      for (const ref of arr(obj(rawSeg).extra_material_refs)) {
        if (typeof ref !== 'string') continue
        for (const name of animsById.get(ref) ?? []) {
          for (const [re, id] of RULES) {
            if (re.test(name)) counts.set(id, (counts.get(id) ?? 0) + 1)
          }
        }
      }
    }
  }
  let best: EntranceId | null = null
  let bestN = 0
  for (const [id, n] of Array.from(counts)) {
    if (n > bestN) { best = id; bestN = n }
  }
  return best
}
