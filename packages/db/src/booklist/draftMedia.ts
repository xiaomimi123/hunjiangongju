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

export function extractDraftMedia(draft: unknown): DraftMediaWanted {
  const materials = obj(obj(draft).materials)
  const bgm: { fileName: string; title: string }[] = []
  const seenBgm = new Set<string>()
  for (const raw of arr(materials.audios)) {
    const a = obj(raw)
    const name = typeof a.name === 'string' ? a.name : ''
    if (!/歌曲/.test(name) || /提取/.test(name)) continue
    const fileName = basename(a.path)
    if (!fileName || seenBgm.has(fileName)) continue
    seenBgm.add(fileName)
    bgm.push({ fileName, title: name })
  }
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
