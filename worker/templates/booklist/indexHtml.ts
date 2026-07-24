// 编排器：选预设 → 算 offset → 逐段组合运镜/转场/字幕/书名头 → 完整 index.html。
// 所有特效叠在既有 startMs/endMs 之上，不新增时长；契约见 docs/superpowers/specs 2026-07-24。
import { sec } from './util.js'
import { selectPreset, seedInt, rootVarsCss } from './theme.js'
import { pickMove, moveTweens, beatAccent, pickTrans, transTweens, shardGrid, shardOpeningTweens } from './motion.js'
import { pickEntrance, captionUnit } from './captionsAnim.js'
import { baseCss, sceneHtml, titleCardHtml, watermarkHtml, bookHeaderHtml, overlayDecorHtml } from './layout.js'

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
}

export function renderIndexHtml(data: BodyData): string {
  const { width, height } = data.size
  const segs = [...data.segments].sort((a, b) => a.startMs - b.startMs)
  if (segs.length === 0) throw new Error('renderIndexHtml: segments 为空')
  const lastEndSec = sec(Math.max(...segs.map((s) => s.endMs)))

  const seed = data.seed ?? ''
  const preset = selectPreset(data.style, seed)
  const offset = seedInt(seed) % 5 // 轮换相位，5 与招式/转场数互质度足够

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
    // 首拍咬合重音（有节拍才叠；无节拍段落起点=段 startMs）
    motionLines.push(beatAccent(n, s.startMs))
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

  return `<!doctype html>
<html lang="zh">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=${width}, height=${height}" />
  <title>booklist body</title>
  <style>
${rootVarsCss(preset)}
${baseCss(preset)}
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
