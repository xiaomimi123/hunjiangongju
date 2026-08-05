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
  flashScale: number // 快闪段「相对填满(cover)」缩放中位数——只取素材 type==='photo' 的段，换算见 coverRelativeScale（无则 1）
  bodyScale: number  // 正片段「相对填满(cover)」缩放中位数——只取素材 type==='photo' 的段，换算见 coverRelativeScale（无则 1）
  segments: { index: number; role: 'open' | 'flash' | 'body'; durationMs: number; scale: number; materialType?: string }[]
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
// material_id → materials.videos[].type（剪映把 photo/video 素材都放在 materials.videos[] 里，靠 type 区分）。
// AI 生成图会替换 photo 素材位，video 素材是创作者自己的实拍/成片镜头，不是"图片位"，
// 缩放基准（flashScale/bodyScale）只应参考 photo 段，否则 video 段的满幅 scale=1 会拉偏中位数。
function materialTypeById(materials: Record<string, unknown>): Map<string, string> {
  const out = new Map<string, string>()
  for (const raw of arr(materials.videos)) {
    const v = obj(raw)
    if (typeof v.id === 'string' && typeof v.type === 'string') out.set(v.id, v.type)
  }
  return out
}
// material_id → materials.videos[].{width,height}（原始素材像素尺寸，供口径换算用）。
function materialDimsById(materials: Record<string, unknown>): Map<string, { width: number; height: number }> {
  const out = new Map<string, { width: number; height: number }>()
  for (const raw of arr(materials.videos)) {
    const v = obj(raw)
    if (typeof v.id === 'string' && typeof v.width === 'number' && v.width > 0 && typeof v.height === 'number' && v.height > 0) {
      out.set(v.id, { width: v.width, height: v.height })
    }
  }
  return out
}
// 剪映 clip.scale=1 语义是「素材完整套入画布」(contain)，不是「填满画布」(cover)。素材宽高比
// 与画布不一致时，raw scale 里混了补偿宽高比差异的部分；换算成「相对填满」口径
// (raw / (coverFill/containFit)) 才是创作者真正的构图缩放意图——AI 生成图按画布比例出图,不需要这层补偿。
// 画布/素材尺寸缺失或非正 → 无法换算,原样返回 raw（不丢段）。
function coverRelativeScale(rawScale: number, srcW: number | undefined, srcH: number | undefined, canvasW: number, canvasH: number): number {
  if (!(typeof srcW === 'number' && srcW > 0 && typeof srcH === 'number' && srcH > 0) || !(canvasW > 0 && canvasH > 0)) {
    return rawScale
  }
  const containFit = Math.min(canvasW / srcW, canvasH / srcH)
  const coverFill = Math.max(canvasW / srcW, canvasH / srcH)
  if (!(containFit > 0)) return rawScale
  return rawScale / (coverFill / containFit)
}

const EMPTY: DraftStructure = {
  openDurationMs: 0, flashCount: 0, flashPerClipMs: 0, flashMinClipMs: 0,
  bodyCount: 0, bodyAvgMs: 0, flashScale: 1, bodyScale: 1, segments: [],
}

export function extractDraftStructure(draft: unknown): DraftStructure {
  try {
    const d = obj(draft)
    const tracks = arr(d.tracks).map(obj)
    const main = tracks.find((t) => t.type === 'video' && t.attribute === 1) ?? tracks.find((t) => t.type === 'video')
    if (!main) return EMPTY
    const materials = obj(d.materials)
    const typeById = materialTypeById(materials)
    const dimsById = materialDimsById(materials)
    const cc = obj(d.canvas_config)
    const canvasW = typeof cc.width === 'number' && cc.width > 0 ? cc.width : 720
    const canvasH = typeof cc.height === 'number' && cc.height > 0 ? cc.height : 960
    const segs = arr(main.segments).map(obj).map((s) => {
      const tt = obj(s.target_timerange)
      const scale = obj(obj(s.clip).scale).x
      const materialId = typeof s.material_id === 'string' ? s.material_id : undefined
      const rawScale = typeof scale === 'number' && scale > 0 ? scale : 1
      const dims = materialId ? dimsById.get(materialId) : undefined
      return {
        durationMs: typeof tt.duration === 'number' ? Math.round(tt.duration / 1000) : 0,
        scale: rawScale,
        relScale: coverRelativeScale(rawScale, dims?.width, dims?.height, canvasW, canvasH),
        materialType: materialId ? typeById.get(materialId) : undefined,
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
    const isPhoto = (s: { materialType?: string }) => s.materialType === 'photo'
    return {
      openDurationMs: segs[0].durationMs,
      flashCount: flashDurs.length,
      flashPerClipMs: avg(flashDurs),
      flashMinClipMs: flashDurs.length ? Math.min(...flashDurs) : 0,
      bodyCount: bodyDurs.length,
      bodyAvgMs: avg(bodyDurs),
      flashScale: median(segs.filter((s, k) => roles[k] === 'flash' && isPhoto(s)).map((s) => s.relScale)),
      bodyScale: median(segs.filter((s, k) => roles[k] === 'body' && isPhoto(s)).map((s) => s.relScale)),
      segments: segs.map((s, k) => ({ index: k, role: roles[k], durationMs: s.durationMs, scale: s.scale, materialType: s.materialType })),
    }
  } catch {
    return EMPTY
  }
}
