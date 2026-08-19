// 三态 provenance：extracted（真提取到）/ defaulted（有概念但没读到，用默认值）/
// unsupported（草稿里确实存在、但我们的渲染器做不到，明确未复刻）。
// detectUnsupported 只扫描草稿里我们已知无法复刻的结构，存在才报、不存在不报——
// 避免报告本身变成噪音（沿用 parseJianyingDraft.ts 既有约定：每个检测项独立
// try/catch，任一项抛错跳过该项、不影响其余，整体 never throw）。

export type ProvenanceStatus = 'extracted' | 'defaulted' | 'unsupported'

export interface ProvenanceEntry {
  path: string
  status: ProvenanceStatus
  detail?: string
}

export interface DraftFidelityReport {
  parsedAt: string
  summary: { extracted: number; defaulted: number; unsupported: number }
  entries: ProvenanceEntry[]
}

// ---- 内部工具（与 parseJianyingDraft.ts 同款兜底写法） ----

function obj(x: unknown): Record<string, unknown> {
  return x && typeof x === 'object' && !Array.isArray(x) ? (x as Record<string, unknown>) : {}
}
function arr(x: unknown): unknown[] {
  return Array.isArray(x) ? x : []
}

export function detectUnsupported(draft: unknown): ProvenanceEntry[] {
  const entries: ProvenanceEntry[] = []
  const d = obj(draft)
  const materials = obj(d.materials)
  const tracks = arr(d.tracks)

  // ---- 独立特效轨：tracks[].type === 'effect' 且有段 ----
  try {
    const hasEffectTrack = tracks.some((rawTrack) => {
      const t = obj(rawTrack)
      return t.type === 'effect' && arr(t.segments).length > 0
    })
    if (hasEffectTrack) {
      entries.push({ path: 'effectTrack', status: 'unsupported', detail: '草稿含独立特效轨，未复刻' })
    }
  } catch {
    // 跳过该项
  }

  // ---- 画面特效素材：materials.video_effects 非空 ----
  try {
    const videoEffects = arr(materials.video_effects)
    if (videoEffects.length > 0) {
      entries.push({
        path: 'videoEffects',
        status: 'unsupported',
        detail: `${videoEffects.length} 处画面特效未复刻`,
      })
    }
  } catch {
    // 跳过该项
  }

  // ---- 文字外发光：materials.effects[].type === 'bloom' ----
  try {
    const bloomCount = arr(materials.effects).filter((e) => obj(e).type === 'bloom').length
    if (bloomCount > 0) {
      entries.push({
        path: 'textGlow',
        status: 'unsupported',
        detail: `${bloomCount} 处文字外发光未复刻`,
      })
    }
  } catch {
    // 跳过该项
  }

  // ---- 真实视频素材段：主视频轨引用 materials.videos[].type === 'video' ----
  try {
    const videosById = new Map<string, Record<string, unknown>>()
    for (const raw of arr(materials.videos)) {
      const v = obj(raw)
      if (typeof v.id === 'string') videosById.set(v.id, v)
    }
    const videoTrack = tracks.map(obj).find((t) => t.type === 'video')
    const segs = videoTrack ? arr(videoTrack.segments) : []
    const videoSegCount = segs.filter((rawSeg) => {
      const seg = obj(rawSeg)
      const materialId = typeof seg.material_id === 'string' ? seg.material_id : undefined
      const v = materialId ? videosById.get(materialId) : undefined
      return v?.type === 'video'
    }).length
    if (videoSegCount > 0) {
      entries.push({
        path: 'videoSegment',
        status: 'unsupported',
        detail: `${videoSegCount} 段真实视频素材（非图片）未复刻`,
      })
    }
  } catch {
    // 跳过该项
  }

  // ---- 逐边界转场差异：materials.transitions[].duration 去重后 >1 种 ----
  try {
    const durations = arr(materials.transitions)
      .map((t) => obj(t).duration)
      .filter((v): v is number => typeof v === 'number')
    const distinct = new Set(durations)
    if (distinct.size > 1) {
      entries.push({
        path: 'transition.perBoundary',
        status: 'unsupported',
        detail: `转场时长有 ${distinct.size} 种取值，现取众数抹平差异`,
      })
    }
  } catch {
    // 跳过该项
  }

  // ---- 文字样式字段：style0.size/strokes 存在，或段 clip.transform.x !== 0 ----
  try {
    let hasStyleField = false
    for (const raw of arr(materials.texts)) {
      const t = obj(raw)
      if (typeof t.content !== 'string') continue
      try {
        const content = obj(JSON.parse(t.content))
        const style0 = obj(arr(content.styles)[0])
        if (style0.size !== undefined || arr(style0.strokes).length > 0) {
          hasStyleField = true
          break
        }
      } catch {
        continue
      }
    }
    if (!hasStyleField) {
      for (const rawTrack of tracks) {
        const track = obj(rawTrack)
        if (track.type !== 'sticker' && track.type !== 'text') continue
        for (const rawSeg of arr(track.segments)) {
          const seg = obj(rawSeg)
          const clip = obj(seg.clip)
          const transform = obj(clip.transform)
          if (typeof transform.x === 'number' && transform.x !== 0) {
            hasStyleField = true
            break
          }
        }
        if (hasStyleField) break
      }
    }
    if (hasStyleField) {
      entries.push({
        path: 'text.style',
        status: 'unsupported',
        detail: '文字描边/字号/水平偏移等样式细节未逐字复刻',
      })
    }
  } catch {
    // 跳过该项
  }

  // ---- 踩点数据：materials.beats[] 里出现真实时间戳数组（非空），
  //      样例里只有 melody_percents 这类阈值参数，没有真实时间戳，不算 ----
  try {
    const hasRealBeatTimestamps = arr(materials.beats).some((rawBeat) => {
      const beat = obj(rawBeat)
      const userBeats = beat.user_beats
      if (Array.isArray(userBeats) && userBeats.length > 0) return true
      const aiBeats = obj(beat.ai_beats)
      const beatsArr = aiBeats.beats
      if (Array.isArray(beatsArr) && beatsArr.length > 0) return true
      return false
    })
    if (hasRealBeatTimestamps) {
      entries.push({
        path: 'beats',
        status: 'unsupported',
        detail: '踩点时间戳未复刻',
      })
    }
  } catch {
    // 跳过该项
  }

  return entries
}

export function buildFidelityReport(entries: ProvenanceEntry[], parsedAt: string): DraftFidelityReport {
  const summary = { extracted: 0, defaulted: 0, unsupported: 0 }
  for (const e of entries) {
    summary[e.status] += 1
  }
  return { parsedAt, summary, entries }
}

const STATUS_SET: ReadonlySet<string> = new Set(['extracted', 'defaulted', 'unsupported'])

function isProvenanceEntry(v: unknown): v is ProvenanceEntry {
  const e = obj(v)
  if (typeof e.path !== 'string') return false
  if (typeof e.status !== 'string' || !STATUS_SET.has(e.status)) return false
  if (e.detail !== undefined && typeof e.detail !== 'string') return false
  return true
}

export function isFidelityReport(v: unknown): v is DraftFidelityReport {
  if (!v || typeof v !== 'object') return false
  const r = v as Record<string, unknown>
  if (typeof r.parsedAt !== 'string') return false
  const summary = obj(r.summary)
  if (
    typeof summary.extracted !== 'number' ||
    typeof summary.defaulted !== 'number' ||
    typeof summary.unsupported !== 'number'
  ) {
    return false
  }
  if (!Array.isArray(r.entries)) return false
  return r.entries.every(isProvenanceEntry)
}
