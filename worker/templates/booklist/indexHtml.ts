// 编排器：选预设 → 算 offset → 逐段组合运镜/转场/字幕/书名头 → 完整 index.html。
// 所有特效叠在既有 startMs/endMs 之上，不新增时长；契约见 docs/superpowers/specs 2026-07-24。
import { sec } from './util.js'
import { selectPreset, seedInt, rootVarsCss } from './theme.js'
import { pickMove, moveTweens, pickTrans, transTweens, shardGrid, shardOpeningTweens } from './motion.js'
import { pickEntrance, captionUnit } from './captionsAnim.js'
import { baseCss, sceneHtml, titleCardHtml, watermarkHtml, bookHeaderHtml, overlayDecorHtml, fontFaceCss, flashCss, subtitleVarsCss } from './layout.js'
import { flashTimeline } from './templateParams.js'
import { openTitleHtml, openTitleTweens, flashCardsHtml, flashCardsTweens } from './flashMontage.js'
import { gradeCss } from './grade.js'

export interface BodyOverlay {
  title: string
  subtitle: string
  watermark: string
}
export interface BodyImage {
  src: string
}
export interface BodySegment {
  seqNo: number
  startMs: number
  endMs: number
  subtitle: string
  imageIndex: number
  bookTitle?: string
  bookAuthor?: string
  subtitleEn?: string
  captionBeats?: { zh: string; en?: string; startMs: number; endMs: number }[]
}
export interface BodyData {
  size: { width: number; height: number }
  overlay: BodyOverlay
  images: BodyImage[]
  segments: BodySegment[]
  /** 框架指定的风格预设 id（framework.overlayTemplate.__style），缺省则由 seed 派生 */
  style?: string
  /** 稳定 seed（genTaskId），驱动预设/招式轮换的确定性 */
  seed?: string
  /** 模板模式：flash=玻璃碎裂开场+书单快闪+叠化正片；缺省/classic=既有编排不变 */
  template?: 'classic' | 'flash'
  templateParams?: import('./templateParams.js').TemplateParams
  flashCovers?: import('./flashMontage.js').FlashCover[]
  fonts?: { family: string; url: string }[]
}

export function renderIndexHtml(data: BodyData): string {
  const { width, height } = data.size
  const segs = [...data.segments].sort((a, b) => a.startMs - b.startMs)
  if (segs.length === 0) throw new Error('renderIndexHtml: segments 为空')
  const lastEndSec = sec(Math.max(...segs.map((s) => s.endMs)))

  const seed = data.seed ?? ''
  const preset = selectPreset(data.style, seed)
  const offset = seedInt(seed) % 5 // 轮换相位，5 与招式/转场数互质度足够

  if (data.template === 'flash' && data.templateParams) return renderFlash(data, preset, offset)

  const imgFor = (s: BodySegment, i: number) => data.images[s.imageIndex]?.src ?? data.images[i]?.src ?? ''

  // ---- 场景 HTML ----
  const scenesHtml = segs.map((s, i) => sceneHtml(i + 1, imgFor(s, i))).join('\n')

  // ---- 首场景玻璃碎片开场 + 各边界转场分配 ----
  const openingShatterHtml = shardGrid({
    containerClass: 'shatter s1shatter', imgSrc: imgFor(segs[0], 0), cols: 4, rows: 5, width, height, startScattered: true,
  })
  // 逐边界（i>=1）选转场；shard 转场需要 .tsN 碎片层
  const transForBoundary: string[] = [] // index i → TransId（i>=1 有效）
  const transShardLayers: string[] = []
  segs.forEach((s, i) => {
    if (i === 0) { transForBoundary.push(''); return }
    const tr = pickTrans(s.seqNo, offset)
    transForBoundary.push(tr)
    if (tr === 'shard') {
      transShardLayers.push(shardGrid({
        containerClass: `tshatter ts${i + 1}`, imgSrc: imgFor(segs[i - 1], i - 1), cols: 3, rows: 3, width, height,
      }))
    }
  })

  // ---- 运镜 + 转场 tween ----
  const motionLines: string[] = []
  segs.forEach((s, i) => {
    const n = i + 1
    const isLast = i === segs.length - 1
    motionLines.push(moveTweens(pickMove(s.seqNo, offset), n, s.startMs, s.endMs, isLast))
    if (i === 0) {
      motionLines.push(`  tl.set('.s1', { opacity: 1 }, 0);`)
      motionLines.push(shardOpeningTweens())
    } else {
      motionLines.push(transTweens(transForBoundary[i] as ReturnType<typeof pickTrans>, n, s.startMs))
    }
    // 末段结尾定格暗角（时长=段长，不外溢）
    if (isLast) {
      const segLenSec = Math.max(0.1, sec(s.endMs - s.startMs))
      motionLines.push(`  tl.fromTo('.vignette', { opacity: 0 }, { opacity: 0.55, duration: ${segLenSec}, ease: 'sine.in' }, ${sec(s.startMs)});`)
    }
  })

  // ---- 字幕单元（有节拍逐拍，否则整段一条）----
  interface CapSrc { zh: string; en?: string; startMs: number; endMs: number }
  const capSrcs: CapSrc[] = []
  for (const s of segs) {
    const beats = Array.isArray(s.captionBeats) ? s.captionBeats : []
    if (beats.length) for (const b of beats) capSrcs.push({ zh: b.zh, en: b.en, startMs: b.startMs, endMs: b.endMs })
    else capSrcs.push({ zh: s.subtitle, en: s.subtitleEn, startMs: s.startMs, endMs: s.endMs })
  }
  const capHtmlParts: string[] = []
  const capTweenParts: string[] = []
  capSrcs.forEach((u, k) => {
    const unit = captionUnit({ n: k + 1, entrance: pickEntrance(k, offset), zh: u.zh, en: u.en, startMs: u.startMs, endMs: u.endMs })
    capHtmlParts.push(unit.html)
    capTweenParts.push(unit.tweens)
  })

  // ---- 书名头 / 标题卡 ----
  const hasBookMode = segs.some((s) => (s.bookTitle ?? '').trim().length > 0)
  interface BookRun { title: string; author?: string; startIdx: number; endIdx: number }
  const bookRuns: BookRun[] = []
  if (hasBookMode) {
    segs.forEach((s, i) => {
      const title = (s.bookTitle ?? '').trim()
      if (!title) return
      const prev = bookRuns[bookRuns.length - 1]
      if (prev && prev.title === title && prev.endIdx === i - 1) prev.endIdx = i
      else bookRuns.push({ title, author: s.bookAuthor, startIdx: i, endIdx: i })
    })
  }
  const bookHeadersHtml = bookRuns.map((r, ri) => bookHeaderHtml(ri + 1, r.title, r.author)).join('\n')
  const bookHeaderTweens = bookRuns
    .map((r, ri) => {
      const n = ri + 1
      const startSec = sec(segs[r.startIdx].startMs)
      if (r.startIdx === 0) return `  tl.set('.bh${n}', { opacity: 1 }, 0);`
      return (
        `  tl.fromTo('.bh${n}', { opacity: 0 }, { opacity: 1, duration: 0.5, ease: 'sine.inOut' }, ${startSec});\n` +
        `  tl.to('.bh${ri}', { opacity: 0, duration: 0.5, ease: 'sine.inOut' }, ${startSec});`
      )
    })
    .join('\n')

  const titleCard = hasBookMode ? '' : titleCardHtml(data.overlay.title, data.overlay.subtitle)
  const watermark = watermarkHtml(data.overlay.watermark)
  const decor = overlayDecorHtml(preset)
  const scrim = `    <div class="scrim" data-layout-ignore></div>`

  const allTweens = [motionLines.join('\n'), bookHeaderTweens, capTweenParts.join('\n')].filter(Boolean).join('\n')
  const gradeCssStr = gradeCss(data.templateParams?.grade)
  const gradeStyleBlock = gradeCssStr ? `\n${gradeCssStr}` : ''

  return `<!doctype html>
<html lang="zh">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=${width}, height=${height}" />
  <title>booklist body</title>
  <style>
${rootVarsCss(preset)}
${baseCss(preset)}${gradeStyleBlock}
  </style>
</head>
<body>
  <main id="root" data-composition-id="main" data-start="0" data-duration="${lastEndSec}" data-width="${width}" data-height="${height}">
${scenesHtml}
${openingShatterHtml}
${transShardLayers.join('\n')}
${scrim}
${decor}
${capHtmlParts.join('\n')}
${bookHeadersHtml}
${titleCard}
${watermark}
  </main>
  <script src="gsap.min.js"></script>
  <script>
    window.__timelines = window.__timelines || {};
    var tl = gsap.timeline({ paused: true });
${allTweens}
    window.__timelines["main"] = tl;
  </script>
</body>
</html>
`
}

// flash 分支：玻璃碎裂开场 + 书单快闪卡（落在第0段窗口内）+ 叠化正片长镜头 + 参数化字幕。
// 复用 classic 的正片/字幕/书名头逻辑，仅第 0 段替换为开场+快闪；转场固定叠化。
function renderFlash(data: BodyData, preset: import('./theme.js').PresetId, offset: number): string {
  const { width, height } = data.size
  const segs = [...data.segments].sort((a, b) => a.startMs - b.startMs)
  const lastEndSec = sec(Math.max(...segs.map((s) => s.endMs)))
  const p = data.templateParams!
  const covers = data.flashCovers ?? []
  const t = flashTimeline(p, segs[0].endMs, covers.length)
  const imgFor = (s: BodySegment, i: number) => data.images[s.imageIndex]?.src ?? data.images[i]?.src ?? ''

  // 场景：第0段=首图(碎裂开场底)；第1..N段=正片
  const scenesHtml = segs.map((s, i) => sceneHtml(i + 1, imgFor(s, i))).join('\n')
  const openingShatterHtml = p.open.shatter
    ? shardGrid({ containerClass: 'shatter s1shatter', imgSrc: imgFor(segs[0], 0), cols: 4, rows: 5, width, height, startScattered: true })
    : ''

  // 运镜/转场：第0段特殊(开场碎裂,不推)；第1..段 轻推(或off) + 固定叠化
  const motionLines: string[] = []
  segs.forEach((s, i) => {
    const n = i + 1
    if (i === 0) {
      motionLines.push(`  tl.set('.s1', { opacity: 1 }, 0);`)
      if (p.open.shatter) motionLines.push(shardOpeningTweens())
    } else {
      if (p.body.kenBurns === 'subtle') {
        // 剪映草稿提取到运镜序列时按顺序循环用（分镜数与原工程不一定一致，循环保节奏感）；否则维持原「轻推」
        const mv = p.motion?.moves?.length ? pickMove(i - 1, 0, p.motion.moves) : 'push-in'
        motionLines.push(moveTweens(mv, n, s.startMs, s.endMs, i === segs.length - 1, p.body.photoScale ?? 1.07))
      }
      // 固定叠化转场
      motionLines.push(transTweens('crossfade', n, s.startMs))
    }
  })

  // 开场标题 + 快闪卡（落在第0段窗口内）
  const openHtml = openTitleHtml(p.open.titleText)
  const cardsHtml = flashCardsHtml(covers, p.flash.titleFontFamily)
  const flashTweens = [openTitleTweens(t.openEndMs), flashCardsTweens(covers, t, p.flash.bounceIn)].join('\n')

  // 正片字幕：仅第1..N段（第0段视觉是快闪，不出底部字幕）
  const capHtmlParts: string[] = []
  const capTweenParts: string[] = []
  let capIdx = 0
  segs.slice(1).forEach((s) => {
    const beats = Array.isArray(s.captionBeats) && s.captionBeats.length
      ? s.captionBeats : [{ zh: s.subtitle, en: s.subtitleEn, startMs: s.startMs, endMs: s.endMs }]
    for (const b of beats) {
      capIdx++
      const unit = captionUnit({ n: capIdx, entrance: pickEntrance(capIdx - 1, offset, p.body.subtitleEntrance), zh: b.zh, en: (b as { en?: string }).en, startMs: b.startMs, endMs: b.endMs })
      capHtmlParts.push(unit.html); capTweenParts.push(unit.tweens)
    }
  })

  // 常驻《书名》大标题：正片段(第1..N)的 bookTitle(per-gen 书名或框架书目)从正片开始(flashEnd)持续显示。
  // 连续同书名合并为一个运行段；显示起点不早于 flashEnd，避免和开场快闪叠字。
  const bodySegs = segs.slice(1)
  interface FlashBookRun { title: string; author?: string; startIdx: number }
  const bookRuns: FlashBookRun[] = []
  bodySegs.forEach((s, i) => {
    const title = (s.bookTitle ?? '').trim()
    if (!title) return
    const prev = bookRuns[bookRuns.length - 1]
    if (!(prev && prev.title === title)) bookRuns.push({ title, author: s.bookAuthor, startIdx: i })
  })
  const bookHeadersHtml = bookRuns.map((r, ri) => bookHeaderHtml(ri + 1, r.title, r.author)).join('\n')
  const bookHeaderTweens = bookRuns
    .map((r, ri) => {
      const n = ri + 1
      const at = Math.max(sec(bodySegs[r.startIdx].startMs), sec(t.flashEndMs))
      const lines = [`  tl.fromTo('.bh${n}', { opacity: 0 }, { opacity: 1, duration: 0.5, ease: 'sine.inOut' }, ${at});`]
      if (ri > 0) lines.push(`  tl.to('.bh${ri}', { opacity: 0, duration: 0.5, ease: 'sine.inOut' }, ${at});`)
      return lines.join('\n')
    })
    .join('\n')

  const scrim = `    <div class="scrim" data-layout-ignore></div>`
  const decor = overlayDecorHtml(preset)
  const watermark = watermarkHtml(data.overlay.watermark)
  const fontsCss = fontFaceCss(data.fonts ?? [])
  const allTweens = [motionLines.join('\n'), flashTweens, bookHeaderTweens, capTweenParts.join('\n')].filter(Boolean).join('\n')
  const gradeCssStr = gradeCss(p.grade)
  const gradeStyleBlock = gradeCssStr ? `\n${gradeCssStr}` : ''

  return `<!doctype html>
<html lang="zh"><head><meta charset="utf-8" />
<meta name="viewport" content="width=${width}, height=${height}" />
<title>booklist flash</title>
<style>
${rootVarsCss(preset)}
${subtitleVarsCss(p.body)}
${fontsCss}
${baseCss(preset)}
${flashCss()}${gradeStyleBlock}
</style></head>
<body>
<main id="root" data-composition-id="main" data-start="0" data-duration="${lastEndSec}" data-width="${width}" data-height="${height}">
${scenesHtml}
${openingShatterHtml}
${scrim}
${decor}
${openHtml}
${cardsHtml}
${bookHeadersHtml}
${capHtmlParts.join('\n')}
${watermark}
</main>
<script src="gsap.min.js"></script>
<script>
  window.__timelines = window.__timelines || {};
  var tl = gsap.timeline({ paused: true });
${allTweens}
  window.__timelines["main"] = tl;
</script>
</body></html>
`
}
