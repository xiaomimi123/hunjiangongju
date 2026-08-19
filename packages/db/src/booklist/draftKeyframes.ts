// 从每段 common_keyframes 提取**实测**的缩放运镜数值，供渲染层照抄（对比 draftMotion.ts：
// 那里是把曲线归类成 6 种预设招式、幅度由渲染层硬编码，这里是原值直出）。
//
// 三条实测依据（样例 今天分享的是/draft_content.json）：
// 1. 正片段各有 49 条「属性轨」，其中 44 条只有 1 个点——那是剪映给每个可调属性的占位，不是动画。
//    真正有动画的只有 ScaleX/ScaleY/Rotation/PositionX/PositionY 这 5 条，各恰好 2 个点。
// 2. Rotation/PositionX/PositionY 三条的首尾值全是 0→0，即存在但未动画。因此**无法**从这份样本
//    确定剪映这些字段的单位（旋转是度还是弧度、位移是归一化还是像素）。没有可验证样本就实现
//    换算等于凭空猜，猜错是静默的画面错位。故本模块只提取缩放，位移/旋转留待有样本时再补。
// 3. 关键帧的 left_control/right_control 均为 (0,0)，即线性插值——渲染层据此用 ease:'none'。
//
// 只取正片段(role==='body')：理由同 draftMotion.ts——快闪卡常带「卡片弹入」式微缩放脉冲，
// 那是卡片效果本身、不是相机运镜，混进来会稀释真实运镜信号。

import { extractDraftStructure, coverRelativeScale } from './draftStructure'

export interface KeyframeScale {
  scaleFrom: number
  scaleTo: number
}

const SCALE_PROPS = ['KFTypeScaleX', 'KFTypeScaleY']

function obj(x: unknown): Record<string, unknown> {
  return x && typeof x === 'object' && !Array.isArray(x) ? (x as Record<string, unknown>) : {}
}
function arr(x: unknown): unknown[] {
  return Array.isArray(x) ? x : []
}
function num(x: unknown): number | undefined {
  return typeof x === 'number' && Number.isFinite(x) ? x : undefined
}

/** 取某段里「恰好 2 个点」的缩放属性轨的首尾值；多条候选取变化幅度最大者（同幅度取先出现者，结果确定）。 */
function scaleEndpoints(kfs: unknown[]): { from: number; to: number } | null {
  let best: { from: number; to: number } | null = null
  let bestAbs = -1
  for (const raw of kfs) {
    const k = obj(raw)
    const prop = typeof k.property_type === 'string' ? k.property_type : ''
    if (!SCALE_PROPS.includes(prop)) continue
    const pts = arr(k.keyframe_list).map(obj)
    // 恰好 2 点才算动画：1 点是占位轨，>2 点本样例未出现（真出现时取首尾仍是合理近似，但会丢中间
    // 转折——届时应在保真度报告里记一条，而不是静默当成线性）。
    if (pts.length !== 2) continue
    const val = (p: Record<string, unknown>) => num(arr(p.values)[0]) ?? 0
    const from = val(pts[0])
    const to = val(pts[1])
    const d = Math.abs(to - from)
    if (d > bestAbs) {
      bestAbs = d
      best = { from, to }
    }
  }
  return best
}

/**
 * 产出与正片段一一对应的缩放序列。
 * - 某段无缩放动画但 clip.scale ≠ 1 → 返回首尾相同的静态值（渲染层据此出 tl.set 钉住构图，
 *   否则画面会回落到 scale 1，把创作者的构图丢掉）。
 * - 全部段都既无动画又无静态缩放 → 返回空数组，让渲染层回退到预设招式。
 *
 * 数值口径与 DraftStructure.segments[].scale 一致：都经 coverRelativeScale 换算成「相对填满(cover)」。
 * 必须换算——剪映 clip.scale=1 的语义是「素材完整套入画布」(contain)，素材宽高比与画布不一致时
 * raw 值里混了补偿宽高比差异的部分。样例的图恰好与画布同比例、换算系数为 1，所以原值刚好等于
 * 换算值；换一份比例不同的工程就不成立，不换算会静默算错。
 */
export function extractDraftKeyframes(draft: unknown): KeyframeScale[] {
  const d = obj(draft)
  const tracks = arr(d.tracks).map(obj)
  const main = tracks.find((t) => t.type === 'video' && t.attribute === 1) ?? tracks.find((t) => t.type === 'video')
  if (!main) return []

  const structure = extractDraftStructure(draft)
  const scaleByIndex = new Map(structure.segments.map((s) => [s.index, s.scale]))
  const roleByIndex = new Map(structure.segments.map((s) => [s.index, s.role]))

  const cc = obj(d.canvas_config)
  const canvasW = num(cc.width) ?? 0
  const canvasH = num(cc.height) ?? 0
  const videos = arr(obj(d.materials).videos).map(obj)
  const srcById = new Map(videos.map((v) => [String(v.id ?? ''), { w: num(v.width), h: num(v.height) }]))

  const segs = arr(main.segments).map(obj)
  const out: KeyframeScale[] = []
  let anyMeaningful = false

  segs.forEach((s, i) => {
    if (roleByIndex.get(i) !== 'body') return
    const src = srcById.get(String(s.material_id ?? '')) ?? { w: undefined, h: undefined }
    const conv = (raw: number) => coverRelativeScale(raw, src.w, src.h, canvasW, canvasH)

    const ep = scaleEndpoints(arr(s.common_keyframes))
    if (ep && ep.from !== ep.to) {
      out.push({ scaleFrom: conv(ep.from), scaleTo: conv(ep.to) })
      anyMeaningful = true
      return
    }
    // 无动画：退回该段的静态缩放（structure 已做过同一套换算）
    const stat = scaleByIndex.get(i) ?? 1
    out.push({ scaleFrom: stat, scaleTo: stat })
    if (stat !== 1) anyMeaningful = true
  })

  return anyMeaningful ? out : []
}
