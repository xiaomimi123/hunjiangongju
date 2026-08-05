// 从剪映 draft_content.json 提取「值得上传入库的媒体文件清单」+ 读框架默认值。
// 纯函数、不抛错。BGM/图片判定规则与 parseJianyingDraft 现行口径一致。

export interface DraftMediaWanted {
  bgm: { fileName: string; title: string }[]
  images: string[]
}

export interface FrameworkDefaults {
  bgmId: string | null
  assetFolder: string | null
}

const IMAGE_EXT = /\.(jpe?g|png|webp)$/i

function obj(x: unknown): Record<string, unknown> {
  return x && typeof x === 'object' && !Array.isArray(x) ? (x as Record<string, unknown>) : {}
}
function arr(x: unknown): unknown[] {
  return Array.isArray(x) ? x : []
}
function basename(p: unknown): string | undefined {
  if (typeof p !== 'string' || !p) return undefined
  const b = p.split('/').pop()
  return b || undefined
}

export interface BgmPick { materialId: string; name: string; volume: number; fileName?: string }

/**
 * BGM 判据：排除 type==='sound' 的音效轨；在剩余音轨里取「音量有值且 < 1.0」中总覆盖时长最长者。
 * 依据：剪映里 BGM 必被压在人声之下（实测 新模板 0.4425 / 旧样例 0.692），人声轨音量 >= 1 或缺省。
 */
export function pickBgmSegment(draft: unknown): BgmPick | null {
  const d = obj(draft)
  const materials = obj(d.materials)
  const audios = new Map<string, Record<string, unknown>>()
  for (const raw of arr(materials.audios)) {
    const a = obj(raw)
    if (typeof a.id === 'string') audios.set(a.id, a)
  }
  const acc = new Map<string, { dur: number; volume: number }>()
  for (const rawTrack of arr(d.tracks)) {
    const track = obj(rawTrack)
    if (track.type !== 'audio') continue
    for (const rawSeg of arr(track.segments)) {
      const seg = obj(rawSeg)
      const mid = typeof seg.material_id === 'string' ? seg.material_id : undefined
      if (!mid) continue
      const mat = audios.get(mid)
      if (!mat || mat.type === 'sound') continue
      const volume = typeof seg.volume === 'number' ? seg.volume : undefined
      if (volume === undefined || volume >= 1) continue
      const dur = typeof obj(seg.target_timerange).duration === 'number' ? (obj(seg.target_timerange).duration as number) : 0
      const prev = acc.get(mid)
      acc.set(mid, { dur: (prev?.dur ?? 0) + dur, volume })
    }
  }
  let bestId: string | undefined
  let best = { dur: -1, volume: 0 }
  for (const [mid, v] of Array.from(acc)) {
    if (v.dur > best.dur) { bestId = mid; best = v }
  }
  if (!bestId) return null
  const mat = audios.get(bestId) ?? {}
  const name = typeof mat.name === 'string' ? mat.name : ''
  const fileName = basename(mat.path)
  return { materialId: bestId, name, volume: best.volume, ...(fileName ? { fileName } : {}) }
}

export function extractDraftMedia(draft: unknown): DraftMediaWanted {
  const materials = obj(obj(draft).materials)
  const picked = pickBgmSegment(draft)
  const bgm = picked?.fileName ? [{ fileName: picked.fileName, title: picked.name || picked.fileName }] : []
  const images: string[] = []
  const seenImg = new Set<string>()
  for (const raw of arr(materials.videos)) {
    const v = obj(raw)
    if (v.type !== 'photo') continue
    const fileName = basename(v.path)
    if (!fileName || !IMAGE_EXT.test(fileName) || seenImg.has(fileName)) continue
    seenImg.add(fileName)
    images.push(fileName)
  }
  return { bgm, images }
}

export function readFrameworkDefaults(overlayTemplate: unknown): FrameworkDefaults {
  const o = obj(overlayTemplate)
  const s = (x: unknown) => (typeof x === 'string' && x.trim() ? x.trim() : null)
  return { bgmId: s(o.__defaultBgmId), assetFolder: s(o.__defaultAssetFolder) }
}
