// 解析剪映草稿 draft_content.json → TemplateParams + DraftMeta。
// 纯函数、不抛错（draft 非对象时返回全默认 + warning）。每个字段抽取块用 try/catch 兜底，
// 缺失/异常时回退 DEFAULT_PARAMS 对应值。最终 params 再过一遍 parseTemplateParams 兜底。

import { DEFAULT_PARAMS, parseTemplateParams, type TemplateParams } from './templateParams'
import { pickBgmSegment } from './draftMedia'
import { extractDraftStructure, type DraftStructure } from './draftStructure'
import { extractDraftGrade } from './draftGrade'
import { extractDraftMoves } from './draftMotion'
import { extractDraftKeyframes, type KeyframeScale } from './draftKeyframes'
import { extractSubtitleEntrance } from './draftTextAnim'
import { detectUnsupported, type ProvenanceEntry, type ProvenanceStatus } from './draftProvenance'

export interface DraftMeta {
  canvas: { width: number; height: number }
  durationMs: number
  segmentCount: number // video track 段数
  fontsNeeded: string[] // 去重的字体名（不含路径）
  bookTitles: string[] // 从文字素材《》抽取
  warnings: string[]
  watermark?: string // 文字里以 @ 开头的一行（如「@欧子好读」）
  structure: DraftStructure // 主视频轨节奏切出的 开场/快闪/正片 三段结构（Task 8 页面报告用）
  provenance: ProvenanceEntry[] // 结构化保真度记录：extracted/defaulted 与 warnings 同源写入，unsupported 来自 detectUnsupported
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

// 剪映 clip.transform.y 符号约定：正值=画面靠上，负值=画面靠下（跨样本实测：
// 《书名》/快闪文字靠上 y=+0.663/+0.565；水印/免责声明靠下 y=-0.793/-0.889；
// 口播字幕靠下三分之一 y=-0.486）。下游 subtitlePosY 是"离底部的归一化距离"
// （worker/templates/booklist/layout.ts: bottom=(1-subtitlePosY)*960，DEFAULT 0.78≈下三分），
// 因此需要 y 越大(越靠上)→ subtitlePosY 越小，公式取 0.5 - y/2。
export function transformYToNorm(y: unknown): number {
  const v = typeof y === 'number' ? y : 0
  return Math.max(0, Math.min(1, 0.5 - v / 2))
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

// 收集「文字/贴纸轨」段（track.type 为 'sticker' 或 'text'，兼容不同剪映模板导出习惯）
function collectStickerSegs(tracks: unknown[]): StickerSeg[] {
  const out: StickerSeg[] = []
  for (const rawTrack of tracks) {
    const track = obj(rawTrack)
    if (track.type !== 'sticker' && track.type !== 'text') continue
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
  const provenance: ProvenanceEntry[] = []
  // note() 是 warnings 与 provenance 唯一的写入口：defaulted 且带 detail 时同时 push 进 warnings，
  // 保证两份记录不会各写各的而漂移。文案必须与改动前 warnings.push 的字符串逐字节相同（回归红线）。
  // pushedDetails 去重：同一句 detail 文案可能被多个"共享同一次回退"的叶子字段各记一条
  // defaulted provenance（如 open.titleText 和 open.durationMs 因同一句「未找到开场标题段…」
  // 一起回退），但 warnings 只应出现一次——去重发生在 warnings 这一层，不影响 provenance 条数。
  const pushedDetails = new Set<string>()
  // warn=false：detail 只进 provenance，不进 warnings。
  // 用于**新增**的提取器——warnings 是被冻结的老契约（解析预览页 buildReport() 在消费它，
  // 且有逐字节比对的回归测试守着），往里加新条目会改变运营看到的报告。provenance 是更丰富的
  // 新记录，加条目不受此限。两者解耦后，新提取器才能既如实留档、又不动老契约。
  const note = (path: string, status: ProvenanceStatus, detail?: string, warn = true) => {
    provenance.push({ path, status, ...(detail ? { detail } : {}) })
    if (warn && status === 'defaulted' && detail && !pushedDetails.has(detail)) {
      warnings.push(detail)
      pushedDetails.add(detail)
    }
  }

  if (!draft || typeof draft !== 'object' || Array.isArray(draft)) {
    note('draft', 'defaulted', 'draft 不是可解析的对象，已回退全默认参数')
    provenance.push(...detectUnsupported(draft))
    return {
      params: parseTemplateParams({ ...DEFAULT_PARAMS, mode: 'flash' }),
      meta: {
        canvas: { width: 720, height: 960 },
        durationMs: 0,
        segmentCount: 0,
        fontsNeeded: [],
        bookTitles: [],
        warnings,
        structure: extractDraftStructure(draft),
        provenance,
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
    const hasWidth = typeof cc.width === 'number'
    const hasHeight = typeof cc.height === 'number'
    const width = hasWidth ? (cc.width as number) : 720
    const height = hasHeight ? (cc.height as number) : 960
    canvas = { width, height }
    // 判据顺序不能颠倒：改动前代码只看"拼出来的 width/height 是否等于 720x960"决定是否告警，
    // 与 canvas_config 是否完整无关——哪怕只给了 width、height 是硬编码默认值，只要拼出来非标准
    // 尺寸，老代码照样会告警（曾在这里踩过一次坑：先判"是否缺字段"会把这条 warning 吞掉，
    // 用 __diff_old_new__ 实证对比时被"canvas_config 只给 width"这组夹具当场揪出来）。
    // 只有在"拼出来恰好是标准尺寸"这个不告警的分支里，才进一步区分"两个维度都真拿到"(extracted)
    // 还是"至少一个维度是硬编码默认值、只是凑巧等于标准值"(defaulted，且不产生新 warning)。
    if (width !== 720 || height !== 960) {
      note('canvas', 'defaulted', `画布尺寸非 720x960 (${width}x${height})，可能影响排版比例`)
    } else if (hasWidth && hasHeight) {
      note('canvas', 'extracted')
    } else {
      note('canvas', 'defaulted')
    }
  } catch {
    note('canvas', 'defaulted', 'canvas_config 解析失败，回退 720x960')
  }

  // ---- duration ----
  let durationMs = 0
  try {
    const hasDuration = typeof d.duration === 'number' && Number.isFinite(d.duration)
    durationMs = usToMs(d.duration)
    // duration 键缺失/类型不对时 usToMs 会安静地返回 0，不抛错——不能把这种情况记成 extracted，
    // 否则残缺草稿会被误报「时长已提取」。同样没有对应的原 warning 文案，只记 provenance。
    note('durationMs', hasDuration ? 'extracted' : 'defaulted')
  } catch {
    note('durationMs', 'defaulted', 'duration 解析失败')
  }

  // ---- video 段数 ----
  let segmentCount = 0
  try {
    const videoTrack = tracks.map(obj).find((t) => t.type === 'video')
    segmentCount = videoTrack ? arr(videoTrack.segments).length : 0
    // 与 canvas/durationMs 同款陷阱：找不到 video 轨时 segmentCount 硬编码回退 0，不抛错，
    // 不能因为"没抛错"就记 extracted——必须真的找到了 video 轨才算。
    note('segmentCount', videoTrack ? 'extracted' : 'defaulted')
  } catch {
    note('segmentCount', 'defaulted', 'video track 段数解析失败')
  }

  // ---- texts 索引 ----
  let textsById = new Map<string, ParsedText>()
  try {
    textsById = parseTexts(materials)
    note('texts', 'extracted')
  } catch {
    note('texts', 'defaulted', '文字素材解析失败')
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
      if (f in FONT_FAMILY_MAP) {
        note(`fontsNeeded.${f}`, 'extracted')
      } else {
        note(`fontsNeeded.${f}`, 'defaulted', `字体「${f}」未在 family 映射表中，需人工确认`)
      }
    }
  } catch {
    note('fontsNeeded', 'defaulted', 'fontsNeeded 解析失败')
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
      note('bookTitles', 'defaulted', '未从文字素材中找到书名(《...》)')
    } else {
      note('bookTitles', 'extracted')
    }
  } catch {
    note('bookTitles', 'defaulted', 'bookTitles 解析失败')
  }

  // 水印：文字里以 @ 开头的一行（如「@欧子好读」）→ 供导入时写进 overlayTemplate.watermark
  let watermark: string | undefined
  try {
    for (const t of Array.from(textsById.values())) {
      const line = t.text.trim()
      if (line.startsWith('@') && line.length > 1) { watermark = line; break }
    }
    if (watermark) note('watermark', 'extracted')
  } catch {
    note('watermark', 'defaulted', '水印解析失败')
  }

  // ---- sticker 段 ----
  let stickers: StickerSeg[] = []
  try {
    stickers = collectStickerSegs(tracks)
    note('stickers', 'extracted')
  } catch {
    note('stickers', 'defaulted', 'sticker track 解析失败')
  }

  const isBookName = (text: string) => /《[^》]+》/.test(text)

  // ---- 开场标题 ----
  let openTitleText = DEFAULT_PARAMS.open.titleText
  let openDurationMs = DEFAULT_PARAMS.open.durationMs
  let openTitleMaterialId: string | undefined
  try {
    // 不用竖直位置(y)判定：不同模板的 y 号约定不一致(实测有正负两种"标题在上"约定，
    // 也有免责声明这类靠下的长文案)，唯一稳定信号是"最早出现、非书名、非水印"。
    const isWatermarkText = (text: string) => text.trim().startsWith('@') && text.trim().length > 1
    const candidates = stickers
      .map((s) => ({ s, t: textsById.get(s.materialId) }))
      .filter((x) => x.t && !isBookName(x.t.text) && !isWatermarkText(x.t.text))
    if (candidates.length > 0) {
      candidates.sort((a, b) => a.s.start - b.s.start)
      const chosen = candidates[0]
      openTitleText = chosen.t!.text || openTitleText
      openDurationMs = usToMs(chosen.s.durationUs)
      openTitleMaterialId = chosen.s.materialId
      // chosen.t!.text 可能是空字符串（文字素材 content 缺失/解析失败时 parseTexts 兜底成 ''），
      // 这种情况下 openTitleText 靠 `|| openTitleText` 静默保留了 DEFAULT_PARAMS 的值——
      // 找到了候选段不等于真读到了标题文字，两者要分开记。
      note('open.titleText', chosen.t!.text ? 'extracted' : 'defaulted')
      note('open.durationMs', 'extracted')
    } else {
      note('open.titleText', 'defaulted', '未找到开场标题段，回退默认标题/时长')
      note('open.durationMs', 'defaulted', '未找到开场标题段，回退默认标题/时长')
    }
  } catch {
    note('open.titleText', 'defaulted', '开场标题解析失败')
    note('open.durationMs', 'defaulted', '开场标题解析失败')
  }

  // ---- 开场动画（破镜重圆/收拢） ----
  let shatter = DEFAULT_PARAMS.open.shatter
  try {
    const animMaterialsRaw = arr(materials.material_animations)
    if (animMaterialsRaw.length === 0) {
      note('open.shatter', 'defaulted', '未找到动画素材(material_animations)，开场动画(破镜重圆)回退默认值')
    } else {
      const animMaterials = animMaterialsRaw.map(obj)
      let found = false
      for (const ma of animMaterials) {
        for (const rawAnim of arr(ma.animations)) {
          const anim = obj(rawAnim)
          const name = typeof anim.name === 'string' ? anim.name : ''
          if (/破镜|收拢|玻璃|聚集|碎/.test(name)) {
            found = true
            break
          }
        }
        if (found) break
      }
      shatter = found
      note('open.shatter', 'extracted')
    }
  } catch {
    note('open.shatter', 'defaulted', '开场动画解析失败')
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
      note('flash.perClipMs', 'extracted')
      note('flash.minClipMs', 'extracted')
    } else {
      note('flash.perClipMs', 'defaulted', '未找到书名快闪段，回退默认快闪时长')
      note('flash.minClipMs', 'defaulted', '未找到书名快闪段，回退默认快闪时长')
    }
  } catch {
    note('flash.perClipMs', 'defaulted', '书名快闪解析失败')
    note('flash.minClipMs', 'defaulted', '书名快闪解析失败')
  }

  // 画面节奏优先：主视频轨切出的三段结构比「靠《书名》文字段」稳（空白模板没有书名也能切）。
  let structure = extractDraftStructure(draft)
  try {
    if (structure.openDurationMs > 0) openDurationMs = structure.openDurationMs
    if (structure.flashCount > 0) {
      flashPerClipMs = structure.flashPerClipMs
      flashMinClipMs = structure.flashMinClipMs
    }
    // extractDraftStructure 找不到主视频轨（或轨里没有段）时返回硬编码的 EMPTY 兜底对象——
    // 形状齐全(所有数字字段=0、segments=[])，try 块本身不抛错，之前无条件记 extracted，
    // 会把"什么都没读到"报成"✓ 已提取节奏结构"（评审终审 Important，与 canvas/durationMs
    // 是同一个缺陷模式：硬编码默认值冒充 extracted）。判据用 segments.length > 0——
    // 只有真的切出了非空段落，才算真提取到。
    note('structure', structure.segments.length > 0 ? 'extracted' : 'defaulted')
    // flash.scale / body.photoScale 是真影响渲染的叶子参数（见下方 built 里的
    // structure.flashScale/bodyScale !== 1 才写入），之前只笼统挂在 'structure' 下，
    // Task 3 按 path 找不到——这里给专属 path，取到非默认缩放才记 extracted
    // （=== 1 即未检测到特殊缩放，等同「没有这回事」，不算 defaulted，沿用 grade/motion 同款
    // "可选字段、没检测到就不记"的约定，不产生新 warning。EMPTY 兜底对象的 flashScale/
    // bodyScale 也恒为 1，天然不会误触发这两条，无需额外判断）。
    if (structure.flashScale !== 1) note('flash.scale', 'extracted')
    if (structure.bodyScale !== 1) note('body.photoScale', 'extracted')
  } catch { note('structure', 'defaulted', '画面节奏结构解析失败') }

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
      // 同一个陷阱：找到候选字幕段 ≠ 真读到了字体/颜色。字体要在 FONT_FAMILY_MAP 里查到
      // 才算 extracted——查不到时 `?? subtitleFontFamily` 静默保留了 DEFAULT_PARAMS 的值；
      // 颜色要 t.colorHex 真存在才算，t?.colorHex 缺失时 subtitleColor 也是静默保留默认值。
      const mappedFont = t?.fontBasename ? FONT_FAMILY_MAP[t.fontBasename] : undefined
      if (mappedFont) {
        subtitleFontFamily = mappedFont
        note('body.subtitleFontFamily', 'extracted')
      } else {
        note('body.subtitleFontFamily', 'defaulted')
      }
      if (t?.colorHex) {
        subtitleColor = t.colorHex
        note('body.subtitleColor', 'extracted')
      } else {
        note('body.subtitleColor', 'defaulted')
      }
      subtitlePosY = transformYToNorm(chosen.y)
      note('body.subtitlePosY', 'extracted')
    } else {
      note('body.subtitleFontFamily', 'defaulted', '未找到正片字幕段，回退默认字幕样式')
      note('body.subtitleColor', 'defaulted', '未找到正片字幕段，回退默认字幕样式')
      note('body.subtitlePosY', 'defaulted', '未找到正片字幕段，回退默认字幕样式')
    }
  } catch {
    note('body.subtitleFontFamily', 'defaulted', '正片字幕样式解析失败')
    note('body.subtitleColor', 'defaulted', '正片字幕样式解析失败')
    note('body.subtitlePosY', 'defaulted', '正片字幕样式解析失败')
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
      note('transition.durationMs', 'extracted')
    } else {
      note('transition.durationMs', 'defaulted', '未找到转场素材，回退默认转场时长')
    }
  } catch {
    note('transition.durationMs', 'defaulted', '转场解析失败')
  }

  // ---- Ken-Burns ----
  let kenBurns: 'subtle' | 'off' = DEFAULT_PARAMS.body.kenBurns
  try {
    const animMaterialsRaw = arr(materials.material_animations)
    if (animMaterialsRaw.length === 0) {
      note('body.kenBurns', 'defaulted', '未找到动画素材(material_animations)，Ken-Burns 回退默认值')
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
      note('body.kenBurns', 'extracted')
    }
  } catch {
    note('body.kenBurns', 'defaulted', 'Ken-Burns 动画解析失败')
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
      note('audio', 'defaulted', '未找到音频轨道，BGM 音量/音效回退默认值')
      note('audio.bgmVolume', 'defaulted', '未找到音频轨道，BGM 音量/音效回退默认值')
      note('audio.sfx.openGear', 'defaulted', '未找到音频轨道，BGM 音量/音效回退默认值')
      note('audio.sfx.transitionDrop', 'defaulted', '未找到音频轨道，BGM 音量/音效回退默认值')
    } else {
      const picked = pickBgmSegment(draft)
      if (picked) {
        bgmVolume = picked.volume
        note('audio.bgmVolume', 'extracted')
      } else {
        note('audio.bgmVolume', 'defaulted', '未找到有效 BGM 音量，回退默认 BGM 音量')
      }

      openGear = audioSegs.some((s) => /齿轮|旋钮|鼠标|单击|点击/.test(s.name))
      transitionDrop = audioSegs.some((s) => /水滴/.test(s.name))
      note('audio.sfx.openGear', 'extracted')
      note('audio.sfx.transitionDrop', 'extracted')
    }
  } catch {
    note('audio', 'defaulted', '音频解析失败')
    note('audio.bgmVolume', 'defaulted', '音频解析失败')
    note('audio.sfx.openGear', 'defaulted', '音频解析失败')
    note('audio.sfx.transitionDrop', 'defaulted', '音频解析失败')
  }

  // ---- 调色 ----
  let grade: ReturnType<typeof extractDraftGrade> = null
  try {
    grade = extractDraftGrade(draft)
    if (grade) note('grade', 'extracted')
  } catch {
    note('grade', 'defaulted', '调色解析失败')
  }

  // ---- 运镜 ----
  let moves: ReturnType<typeof extractDraftMoves> = []
  // keyframes 与 moves 并存：前者是照抄的实测数值(渲染层优先用)，后者是归类后的预设招式(回退)。
  // 分开提取而不是二选一——万一关键帧提取不到，moves 仍能给出一个像样的近似。
  let keyframes: KeyframeScale[] = []
  try {
    keyframes = extractDraftKeyframes(draft)
    if (keyframes.length > 0) note('motion.keyframes', 'extracted')
    else note('motion.keyframes', 'defaulted', '未提取到可用的缩放关键帧，运镜回退预设招式', false)
  } catch {
    note('motion.keyframes', 'defaulted', '运镜关键帧解析失败', false)
  }
  try {
    moves = extractDraftMoves(draft)
    if (moves.length > 0) note('motion.moves', 'extracted')
  } catch {
    note('motion.moves', 'defaulted', '运镜解析失败')
  }

  // ---- 字幕入场动画 ----
  let entrance: ReturnType<typeof extractSubtitleEntrance> = null
  try {
    entrance = extractSubtitleEntrance(draft)
    if (entrance) note('body.subtitleEntrance', 'extracted')
  } catch {
    note('body.subtitleEntrance', 'defaulted', '字幕入场动画解析失败')
  }

  const built: Record<string, unknown> = {
    mode: 'flash',
    open: { durationMs: openDurationMs, shatter, titleText: openTitleText, sfx: openGear },
    flash: {
      perClipMs: flashPerClipMs,
      minClipMs: flashMinClipMs,
      bounceIn: DEFAULT_PARAMS.flash.bounceIn,
      titleFontFamily: DEFAULT_PARAMS.flash.titleFontFamily,
      ...(structure.flashScale !== 1 ? { scale: structure.flashScale } : {}),
    },
    transition: { type: 'dissolve', durationMs: transitionDurationMs },
    body: {
      subtitleFontFamily, subtitleColor, subtitlePosY, kenBurns,
      ...(structure.bodyScale !== 1 ? { photoScale: structure.bodyScale } : {}),
      ...(entrance ? { subtitleEntrance: entrance } : {}),
    },
    audio: { bgmVolume, sfx: { openGear, transitionDrop } },
    ...(grade ? { grade } : {}),
    ...(moves.length || keyframes.length
      ? { motion: { moves, ...(keyframes.length ? { keyframes } : {}) } }
      : {}),
  }

  // 最后合入 detectUnsupported：草稿里确实存在、但渲染器做不到的结构（如独立特效轨），
  // 与前面逐字段记录的 extracted/defaulted 一起构成完整的三态 provenance。
  try {
    provenance.push(...detectUnsupported(draft))
  } catch {
    // detectUnsupported 自身已 never throw，这里仅作双重保险，不产生新 warning
  }

  const meta: DraftMeta = {
    canvas,
    durationMs,
    segmentCount,
    fontsNeeded,
    bookTitles,
    warnings,
    structure,
    provenance,
    ...(watermark ? { watermark } : {}),
  }

  return { params: parseTemplateParams(built), meta }
}
