// 从每段 common_keyframes 的首尾差值分类运镜。阈值 0.02（归一化坐标/缩放），低于此视为无运镜。
// 剪映 y 轴向上为负：Δy < 0 = 上移(drift-up)，Δy > 0 = 下沉(tilt-settle 近似)。

export type MoveId = 'push-in' | 'pull-back' | 'pan-right' | 'pan-left' | 'drift-up' | 'tilt-settle'

const EPS = 0.02

function obj(x: unknown): Record<string, unknown> {
  return x && typeof x === 'object' && !Array.isArray(x) ? (x as Record<string, unknown>) : {}
}
function arr(x: unknown): unknown[] {
  return Array.isArray(x) ? x : []
}

/** 取一条关键帧曲线的首尾值差；点数 < 2 或数据异常 → 0 */
function deltaOf(kfs: unknown[], props: string[]): number {
  for (const raw of kfs) {
    const k = obj(raw)
    const prop = typeof k.property_type === 'string' ? k.property_type : ''
    if (!props.includes(prop)) continue
    const pts = arr(k.keyframe_list).map(obj)
    if (pts.length < 2) continue
    const val = (p: Record<string, unknown>) => {
      const vs = arr(p.values)
      return typeof vs[0] === 'number' ? (vs[0] as number) : 0
    }
    return val(pts[pts.length - 1]) - val(pts[0])
  }
  return 0
}

export function extractDraftMoves(draft: unknown): MoveId[] {
  const tracks = arr(obj(draft).tracks).map(obj)
  const main = tracks.find((t) => t.type === 'video' && t.attribute === 1) ?? tracks.find((t) => t.type === 'video')
  if (!main) return []
  const segs = arr(main.segments).map(obj)
  const out: MoveId[] = []
  segs.forEach((s, i) => {
    if (i === 0) return // 开场段的动画另有开场特效负责
    const kfs = arr(s.common_keyframes)
    if (kfs.length === 0) return
    const dx = deltaOf(kfs, ['KFTypePositionX'])
    const dy = deltaOf(kfs, ['KFTypePositionY'])
    const dz = deltaOf(kfs, ['KFTypeScaleX', 'KFTypeScaleY'])
    const mags: [number, MoveId][] = [
      [Math.abs(dx), dx >= 0 ? 'pan-right' : 'pan-left'],
      [Math.abs(dy), dy < 0 ? 'drift-up' : 'tilt-settle'],
      [Math.abs(dz), dz >= 0 ? 'push-in' : 'pull-back'],
    ]
    mags.sort((a, b) => b[0] - a[0])
    if (mags[0][0] > EPS) out.push(mags[0][1])
  })
  return out
}
