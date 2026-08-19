// 逐边界转场提取。对比现状：解析器只读 materials.transitions[] 的**全局众数**套给所有边界，
// 既抹平了不同边界的时长差异，也把"没有转场"（硬切）当成了"有转场"。
//
// 实测语义（样例 今天分享的是/draft_content.json）：
// 转场素材通过 segment.extra_material_refs 挂在**转出的那一段**上，最后一段没有。
//   seg10 → 300ms、seg11 → 500ms、seg12 → 500ms，其余 10 个边界**没有任何转场素材**。
// 即：13 个边界里只有 3 个有转场，整个快闪段（seg1..seg10 之间）是硬切。
//
// 硬切必须表达为 null 而不是"时长 0 的叠化"——两者在渲染层行为不同：前者不生成 tween，
// 后者仍会生成一个退化的 tween。

export type TransRenderType = 'crossfade' | 'wipe' | 'shard' | 'glide-push' | 'blur-dissolve'

export interface DraftTransition {
  /** 边界下标 i：位于 segments[i] 与 segments[i+1] 之间 */
  boundaryIndex: number
  /** 剪映原始转场名，如「叠化」 */
  sourceName: string
  renderType: TransRenderType
  durationMs: number
  /** false = 原始名未在映射表中，已退化为 crossfade */
  mapped: boolean
}

// 起步只收录样例出现过的「叠化」。遇到别的转场名一律退化 crossfade 并标 mapped:false，
// 由保真度报告如实告知运营，而不是静默当成叠化。映射表随遇到的工程逐步扩充。
export const JIANYING_TRANSITION_MAP: Record<string, TransRenderType> = {
  叠化: 'crossfade',
}

function obj(x: unknown): Record<string, unknown> {
  return x && typeof x === 'object' && !Array.isArray(x) ? (x as Record<string, unknown>) : {}
}
function arr(x: unknown): unknown[] {
  return Array.isArray(x) ? x : []
}
function usToMs(us: unknown): number {
  return typeof us === 'number' && Number.isFinite(us) ? Math.round(us / 1000) : 0
}

/**
 * 产出与主视频轨边界一一对应的数组，长度 = 段数 - 1。
 * 第 i 项对应 segments[i] → segments[i+1] 这个边界；`null` 表示硬切（该段没有挂转场素材）。
 * 段数 < 2 或无主视频轨 → 空数组。
 */
export function extractDraftTransitions(draft: unknown): (DraftTransition | null)[] {
  const d = obj(draft)
  const tracks = arr(d.tracks).map(obj)
  const main = tracks.find((t) => t.type === 'video' && t.attribute === 1) ?? tracks.find((t) => t.type === 'video')
  if (!main) return []

  const segs = arr(main.segments).map(obj)
  if (segs.length < 2) return []
  // 按时间排序：JSON 里的段顺序不保证等于时间轴顺序，而"边界"是时间概念。
  const ordered = [...segs].sort((a, b) => {
    const ta = obj(a.target_timerange)
    const tb = obj(b.target_timerange)
    return (typeof ta.start === 'number' ? ta.start : 0) - (typeof tb.start === 'number' ? tb.start : 0)
  })

  const transById = new Map<string, Record<string, unknown>>()
  for (const raw of arr(obj(d.materials).transitions)) {
    const t = obj(raw)
    const id = typeof t.id === 'string' ? t.id : ''
    if (id) transById.set(id, t)
  }

  const out: (DraftTransition | null)[] = []
  for (let i = 0; i < ordered.length - 1; i++) {
    const refs = arr(ordered[i].extra_material_refs).filter((r): r is string => typeof r === 'string')
    const hit = refs.map((r) => transById.get(r)).find((t): t is Record<string, unknown> => !!t)
    if (!hit) {
      out.push(null) // 硬切
      continue
    }
    const sourceName = typeof hit.name === 'string' ? hit.name : ''
    const mappedType = JIANYING_TRANSITION_MAP[sourceName]
    out.push({
      boundaryIndex: i,
      sourceName,
      renderType: mappedType ?? 'crossfade',
      durationMs: usToMs(hit.duration),
      mapped: mappedType !== undefined,
    })
  }
  return out
}
