// 解析剪映草稿 draft_content.json → TemplateParams + DraftMeta。
// 纯函数、不抛错（draft 非对象时返回全默认 + warning）。每个字段抽取块用 try/catch 兜底，
// 缺失/异常时回退 DEFAULT_PARAMS 对应值。最终 params 再过一遍 parseTemplateParams 兜底。

import { DEFAULT_PARAMS, parseTemplateParams, type TemplateParams } from './templateParams'

export interface DraftMeta {
  canvas: { width: number; height: number }
  durationMs: number
  segmentCount: number // video track 段数
  fontsNeeded: string[] // 去重的字体名（不含路径）
  bookTitles: string[] // 从文字素材《》抽取
  warnings: string[]
}

// ---- 纯函数 helpers（导出以便单测/复用） ----

export function usToMs(us: unknown): number {
  return typeof us === 'number' && Number.isFinite(us) ? Math.round(us / 1000) : 0
}

export function rgbToHex(c: unknown): string | undefined {
  if (!Array.isArray(c) || c.length < 3) return undefined
  const h = (n: unknown) =>
    Math.max(0, Math.min(255, Math.round((typeof n === 'number' ? n : 0) * 255)))
      .toString(16)
      .padStart(2, '0')
  return `#${h(c[0])}${h(c[1])}${h(c[2])}`
}

export function transformYToNorm(y: unknown): number {
  const v = typeof y === 'number' ? y : 0
  return Math.max(0, Math.min(1, 0.5 + v / 2))
}

export function fontBasename(path: unknown): string | undefined {
  if (typeof path !== 'string' || !path) return undefined
  const base = path.split('/').pop() || path
  return base.replace(/\.(ttf|otf|ttc)$/i, '').trim() || undefined
}

// ---- 内部工具 ----

function obj(x: unknown): Record<string, unknown> {
  return x && typeof x === 'object' && !Array.isArray(x) ? (x as Record<string, unknown>) : {}
}
function arr(x: unknown): unknown[] {
  return Array.isArray(x) ? x : []
}

const FONT_FAMILY_MAP: Record<string, string> = {
  字由玄真: 'flash-title',
  '三极极宋 超粗新': 'flash-title',
  莫雪体: 'subtitle',
}

interface ParsedText {
  materialId: string
  text: string
  fontBasename?: string
  colorHex?: string
}

interface StickerSeg {
  materialId: string
  start: number
  durationUs: number
  y: number
  extraRefs: string[]
}

function parseTexts(materials: Record<string, unknown>): Map<string, ParsedText> {
  const out = new Map<string, ParsedText>()
  for (const raw of arr(materials.texts)) {
    const t = obj(raw)
    const id = typeof t.id === 'string' ? t.id : undefined
    if (!id) continue
    try {
      const content = typeof t.content === 'string' ? JSON.parse(t.content) : undefined
      const c = obj(content)
      const text = typeof c.text === 'string' ? c.text : ''
      const styles = arr(c.styles)
      const style0 = obj(styles[0])
      const font = obj(style0.font)
      const fill = obj(style0.fill)
      const fillContent = obj(fill.content)
      const solid = obj(fillContent.solid)
      out.set(id, {
        materialId: id,
        text,
        fontBasename: fontBasename(font.path),
        colorHex: rgbToHex(solid.color),
      })
    } catch {
      out.set(id, { materialId: id, text: '' })
    }
  }
  return out
}

function collectStickerSegs(tracks: unknown[]): StickerSeg[] {
  const out: StickerSeg[] = []
  for (const rawTrack of tracks) {
    const track = obj(rawTrack)
    if (track.type !== 'sticker') continue
    for (const rawSeg of arr(track.segments)) {
      const seg = obj(rawSeg)
      const materialId = typeof seg.material_id === 'string' ? seg.material_id : undefined
      if (!materialId) continue
      const tt = obj(seg.target_timerange)
      const clip = obj(seg.clip)
      const transform = obj(clip.transform)
      const start = typeof tt.start === 'number' ? tt.start : 0
      const durationUs = typeof tt.duration === 'number' ? tt.duration : 0
      const y = typeof transform.y === 'number' ? transform.y : 0
      const extraRefs = arr(seg.extra_material_refs).filter((r): r is string => typeof r === 'string')
      out.push({ materialId, start, durationUs, y, extraRefs })
    }
  }
  return out
}

export function parseJianyingDraft(draft: unknown): { params: TemplateParams; meta: DraftMeta } {
  const warnings: string[] = []

  if (!draft || typeof draft !== 'object' || Array.isArray(draft)) {
    warnings.push('draft 不是可解析的对象，已回退全默认参数')
    return {
      params: parseTemplateParams({ ...DEFAULT_PARAMS, mode: 'flash' }),
      meta: {
        canvas: { width: 720, height: 960 },
        durationMs: 0,
        segmentCount: 0,
        fontsNeeded: [],
        bookTitles: [],
        warnings,
      },
    }
  }

  const d = draft as Record<string, unknown>
  const materials = obj(d.materials)
  const tracks = arr(d.tracks)

  // ---- canvas ----
  let canvas = { width: 720, height: 960 }
  try {
    const cc = obj(d.canvas_config)
    const width = typeof cc.width === 'number' ? cc.width : 720
    const height = typeof cc.height === 'number' ? cc.height : 960
    canvas = { width, height }
    if (width !== 720 || height !== 960) {
      warnings.push(`画布尺寸非 720x960 (${width}x${height})，可能影响排版比例`)
    }
  } catch {
    warnings.push('canvas_config 解析失败，回退 720x960')
  }

  // ---- duration ----
  let durationMs = 0
  try {
    durationMs = usToMs(d.duration)
  } catch {
    warnings.push('duration 解析失败')
  }

  // ---- video 段数 ----
  let segmentCount = 0
  try {
    const videoTrack = tracks.map(obj).find((t) => t.type === 'video')
    segmentCount = videoTrack ? arr(videoTrack.segments).length : 0
  } catch {
    warnings.push('video track 段数解析失败')
  }

  // ---- texts 索引 ----
  let textsById = new Map<string, ParsedText>()
  try {
    textsById = parseTexts(materials)
  } catch {
    warnings.push('文字素材解析失败')
  }

  // ---- fontsNeeded ----
  let fontsNeeded: string[] = []
  try {
    const set = new Set<string>()
    for (const t of Array.from(textsById.values())) {
      if (t.fontBasename) set.add(t.fontBasename)
    }
    fontsNeeded = Array.from(set)
    for (const f of fontsNeeded) {
      if (!(f in FONT_FAMILY_MAP)) {
        warnings.push(`字体「${f}」未在 family 映射表中，需人工确认`)
      }
    }
  } catch {
    warnings.push('fontsNeeded 解析失败')
  }

  // ---- bookTitles ----
  let bookTitles: string[] = []
  try {
    const set = new Set<string>()
    for (const t of Array.from(textsById.values())) {
      const re = /《([^》]+)》/g
      let m: RegExpExecArray | null
      while ((m = re.exec(t.text))) {
        const name = m[1].trim()
        if (name) set.add(name)
      }
    }
    bookTitles = Array.from(set)
    if (bookTitles.length === 0) {
      warnings.push('未从文字素材中找到书名(《...》)')
    }
  } catch {
    warnings.push('bookTitles 解析失败')
  }

  // ---- sticker 段 ----
  let stickers: StickerSeg[] = []
  try {
    stickers = collectStickerSegs(tracks)
  } catch {
    warnings.push('sticker track 解析失败')
  }

  const isBookName = (text: string) => /《[^》]+》/.test(text)

  // ---- 开场标题 ----
  let openTitleText = DEFAULT_PARAMS.open.titleText
  let openDurationMs = DEFAULT_PARAMS.open.durationMs
  let openTitleMaterialId: string | undefined
  try {
    const candidates = stickers
      .map((s) => ({ s, t: textsById.get(s.materialId) }))
      .filter((x) => x.t && !isBookName(x.t.text) && x.s.y < 0)
    if (candidates.length > 0) {
      candidates.sort((a, b) => a.s.start - b.s.start)
      const chosen = candidates[0]
      openTitleText = chosen.t!.text || openTitleText
      openDurationMs = usToMs(chosen.s.durationUs)
      openTitleMaterialId = chosen.s.materialId
    } else {
      warnings.push('未找到开场标题段，回退默认标题/时长')
    }
  } catch {
    warnings.push('开场标题解析失败')
  }

  // ---- 开场动画（破镜重圆/收拢） ----
  let shatter = DEFAULT_PARAMS.open.shatter
  try {
    const animMaterialsRaw = arr(materials.material_animations)
    if (animMaterialsRaw.length === 0) {
      warnings.push('未找到动画素材(material_animations)，开场动画(破镜重圆)回退默认值')
    } else {
      const animMaterials = animMaterialsRaw.map(obj)
      let found = false
      for (const ma of animMaterials) {
        for (const rawAnim of arr(ma.animations)) {
          const anim = obj(rawAnim)
          const name = typeof anim.name === 'string' ? anim.name : ''
          if (/破镜|收拢/.test(name)) {
            found = true
            break
          }
        }
        if (found) break
      }
      shatter = found
    }
  } catch {
    warnings.push('开场动画解析失败')
  }

  // ---- 书名快闪 ----
  let flashPerClipMs = DEFAULT_PARAMS.flash.perClipMs
  let flashMinClipMs = DEFAULT_PARAMS.flash.minClipMs
  try {
    const flashSegs = stickers.filter((s) => {
      const t = textsById.get(s.materialId)
      if (!t || !isBookName(t.text)) return false
      if (s.y <= 0) return false
      const ms = usToMs(s.durationUs)
      return ms < 800
    })
    if (flashSegs.length > 0) {
      const durs = flashSegs.map((s) => usToMs(s.durationUs))
      flashPerClipMs = Math.round(durs.reduce((a, b) => a + b, 0) / durs.length)
      flashMinClipMs = Math.min(...durs)
    } else {
      warnings.push('未找到书名快闪段，回退默认快闪时长')
    }
  } catch {
    warnings.push('书名快闪解析失败')
  }

  // ---- 正片字幕样式 ----
  let subtitleFontFamily = DEFAULT_PARAMS.body.subtitleFontFamily
  let subtitleColor = DEFAULT_PARAMS.body.subtitleColor
  let subtitlePosY = DEFAULT_PARAMS.body.subtitlePosY
  try {
    const subtitleCandidates = stickers.filter((s) => {
      if (s.materialId === openTitleMaterialId) return false
      const t = textsById.get(s.materialId)
      if (!t || isBookName(t.text)) return false
      return true
    })
    if (subtitleCandidates.length > 0) {
      // 取时长最长（最“成句”）的一段代表正片字幕样式
      subtitleCandidates.sort((a, b) => b.durationUs - a.durationUs)
      const chosen = subtitleCandidates[0]
      const t = textsById.get(chosen.materialId)
      if (t?.fontBasename) {
        subtitleFontFamily = FONT_FAMILY_MAP[t.fontBasename] ?? subtitleFontFamily
      }
      if (t?.colorHex) subtitleColor = t.colorHex
      subtitlePosY = transformYToNorm(chosen.y)
    } else {
      warnings.push('未找到正片字幕段，回退默认字幕样式')
    }
  } catch {
    warnings.push('正片字幕样式解析失败')
  }

  // ---- 转场 ----
  let transitionDurationMs = DEFAULT_PARAMS.transition.durationMs
  try {
    const transitions = arr(materials.transitions).map(obj)
    const durationsUs = transitions
      .map((t) => (typeof t.duration === 'number' ? t.duration : undefined))
      .filter((v): v is number => typeof v === 'number')
    if (durationsUs.length > 0) {
      const counts = new Map<number, number>()
      for (const v of durationsUs) counts.set(v, (counts.get(v) ?? 0) + 1)
      let best = durationsUs[0]
      let bestCount = 0
      for (const [v, c] of Array.from(counts)) {
        if (c > bestCount || (c === bestCount && v > best)) {
          best = v
          bestCount = c
        }
      }
      transitionDurationMs = usToMs(best)
    } else {
      warnings.push('未找到转场素材，回退默认转场时长')
    }
  } catch {
    warnings.push('转场解析失败')
  }

  // ---- Ken-Burns ----
  let kenBurns: 'subtle' | 'off' = DEFAULT_PARAMS.body.kenBurns
  try {
    const animMaterialsRaw = arr(materials.material_animations)
    if (animMaterialsRaw.length === 0) {
      warnings.push('未找到动画素材(material_animations)，Ken-Burns 回退默认值')
    } else {
      const animMaterials = animMaterialsRaw.map(obj)
      let hasVideoAnim = false
      for (const ma of animMaterials) {
        for (const rawAnim of arr(ma.animations)) {
          const anim = obj(rawAnim)
          const materialType = typeof anim.material_type === 'string' ? anim.material_type : ''
          if (materialType.toLowerCase().includes('video')) {
            hasVideoAnim = true
            break
          }
        }
        if (hasVideoAnim) break
      }
      kenBurns = hasVideoAnim ? 'subtle' : 'off'
    }
  } catch {
    warnings.push('Ken-Burns 动画解析失败')
  }

  // ---- 音频 ----
  let bgmVolume = DEFAULT_PARAMS.audio.bgmVolume
  let openGear = DEFAULT_PARAMS.audio.sfx.openGear
  let transitionDrop = DEFAULT_PARAMS.audio.sfx.transitionDrop
  try {
    const audiosById = new Map<string, string>()
    for (const raw of arr(materials.audios)) {
      const a = obj(raw)
      if (typeof a.id === 'string' && typeof a.name === 'string') audiosById.set(a.id, a.name)
    }

    interface AudioSeg { name: string; volume?: number; durationUs: number }
    const audioSegs: AudioSeg[] = []
    for (const rawTrack of tracks) {
      const track = obj(rawTrack)
      if (track.type !== 'audio') continue
      for (const rawSeg of arr(track.segments)) {
        const seg = obj(rawSeg)
        const materialId = typeof seg.material_id === 'string' ? seg.material_id : undefined
        const name = materialId ? audiosById.get(materialId) : undefined
        if (!name) continue
        const tt = obj(seg.target_timerange)
        const durationUs = typeof tt.duration === 'number' ? tt.duration : 0
        const volume = typeof seg.volume === 'number' ? seg.volume : undefined
        audioSegs.push({ name, volume, durationUs })
      }
    }

    if (audioSegs.length === 0) {
      warnings.push('未找到音频轨道，BGM 音量/音效回退默认值')
    } else {
      // BGM 候选：名称含"歌曲"且不含"提取"，避开剪映自动生成的"提取音乐..."参考轨
      // （"提取音乐"里含"音乐"这个子串，若仍按 /歌曲|音乐/ 匹配会被误选中）
      const songCandidates = audioSegs.filter((s) => /歌曲/.test(s.name) && !/提取/.test(s.name))
      let bgmChosen: AudioSeg | undefined
      if (songCandidates.length > 0) {
        songCandidates.sort((a, b) => b.durationUs - a.durationUs)
        bgmChosen = songCandidates[0]
      } else {
        // 没有可识别的"歌曲"候选：退而求其次，取时长最长且有明确 volume 的音轨
        const withVolume = audioSegs.filter((s) => typeof s.volume === 'number')
        if (withVolume.length > 0) {
          withVolume.sort((a, b) => b.durationUs - a.durationUs)
          bgmChosen = withVolume[0]
        }
      }
      if (bgmChosen && typeof bgmChosen.volume === 'number') {
        bgmVolume = bgmChosen.volume
      } else {
        warnings.push('未找到有效 BGM 音量，回退默认 BGM 音量')
      }

      openGear = audioSegs.some((s) => /齿轮|旋钮/.test(s.name))
      transitionDrop = audioSegs.some((s) => /水滴/.test(s.name))
    }
  } catch {
    warnings.push('音频解析失败')
  }

  const built: Record<string, unknown> = {
    mode: 'flash',
    open: { durationMs: openDurationMs, shatter, titleText: openTitleText, sfx: openGear },
    flash: {
      perClipMs: flashPerClipMs,
      minClipMs: flashMinClipMs,
      bounceIn: DEFAULT_PARAMS.flash.bounceIn,
      titleFontFamily: DEFAULT_PARAMS.flash.titleFontFamily,
    },
    transition: { type: 'dissolve', durationMs: transitionDurationMs },
    body: { subtitleFontFamily, subtitleColor, subtitlePosY, kenBurns },
    audio: { bgmVolume, sfx: { openGear, transitionDrop } },
  }

  const meta: DraftMeta = {
    canvas,
    durationMs,
    segmentCount,
    fontsNeeded,
    bookTitles,
    warnings,
  }

  return { params: parseTemplateParams(built), meta }
}
