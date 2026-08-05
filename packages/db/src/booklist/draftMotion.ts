// 从每段 common_keyframes 的首尾差值分类运镜。阈值 0.02（归一化坐标/缩放），低于此视为无运镜。
// 剪映 y 轴向上为负：Δy < 0 = 上移(drift-up)，Δy > 0 = 下沉(tilt-settle 近似)。
// 只取正片段(role==='body')：快闪卡片(100~200ms)常带一个「卡片弹入」式微缩放脉冲，
// 那是快闪卡效果本身、不是相机运镜；渲染层(Task 7)按 moves 数组循环套到正片段上，
// 混进快闪脉冲会把真实运镜信号稀释掉（见 fix round 1）。

import { extractDraftStructure } from './draftStructure'

export type MoveId = 'push-in' | 'pull-back' | 'pan-right' | 'pan-left' | 'drift-up' | 'tilt-settle'

const EPS = 0.02

function obj(x: unknown): Record<string, unknown> {
  return x && typeof x === 'object' && !Array.isArray(x) ? (x as Record<string, unknown>) : {}
}
function arr(x: unknown): unknown[] {
  return Array.isArray(x) ? x : []
}

/**
 * 取候选属性(props，可能多条，如 ScaleX/ScaleY 都算"缩放")里各自的首尾值差，
 * 返回绝对值最大的那条（同幅度取先出现者，结果确定）。
 * 不能只取第一条命中的属性：JSON 里 ScaleY 可能排在 ScaleX 前面，若两者符号相反，
 * "先出现者优先"会让分类结果取决于素材导出时的字段顺序，而不是真正主导的缩放方向。
 * 点数 < 2 或无匹配属性 → 0。
 */
function deltaOf(kfs: unknown[], props: string[]): number {
  let best = 0
  let bestAbs = -1
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
    const d = val(pts[pts.length - 1]) - val(pts[0])
    if (Math.abs(d) > bestAbs) {
      bestAbs = Math.abs(d)
      best = d
    }
  }
  return best
}

export function extractDraftMoves(draft: unknown): MoveId[] {
  const tracks = arr(obj(draft).tracks).map(obj)
  const main = tracks.find((t) => t.type === 'video' && t.attribute === 1) ?? tracks.find((t) => t.type === 'video')
  if (!main) return []
  const segs = arr(main.segments).map(obj)
  // role 判定复用 Task 2 的 extractDraftStructure（同一条主视频轨、同样的下标），
  // 避免与「开场/快闪/正片」三段切分逻辑产生第二套判定标准。
  const roleByIndex = new Map(extractDraftStructure(draft).segments.map((s) => [s.index, s.role]))
  const out: MoveId[] = []
  segs.forEach((s, i) => {
    if (roleByIndex.get(i) !== 'body') return // 只取正片段：开场/快闪段的动画另有其效果负责
    const kfs = arr(s.common_keyframes)
    if (kfs.length === 0) return
    const dx = deltaOf(kfs, ['KFTypePositionX'])
    const dy = deltaOf(kfs, ['KFTypePositionY'])
    const dz = deltaOf(kfs, ['KFTypeScaleX', 'KFTypeScaleY'])
    // 幅度相等时的裁决优先级由数组书写顺序决定：横移(dx) > 竖移(dy) > 缩放(dz)。
    // Array.prototype.sort 自 ES2019 起保证 stable，幅度相等(如 |dx|===|dz| 精确相等)
    // 时会保留原数组顺序，即优先选横移——这不是巧合，是本函数依赖的行为。
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
