// 编排器：选预设 → 算 offset → 逐段组合运镜/转场/字幕/书名头 → 完整 index.html。
// 所有特效叠在既有 startMs/endMs 之上，不新增时长；契约见 docs/superpowers/specs 2026-07-24。
import { sec } from './util.js'
import { selectPreset, seedInt, rootVarsCss } from './theme.js'
import { pickMove, moveTweens, keyframeTween, pickTrans, transTweens, hardCutTweens, shardGrid, shardOpeningTweens } from './motion.js'
import { rippleHtml, rippleCss, rippleTweens } from './effects.js'
import { pickEntrance, captionUnit } from './captionsAnim.js'
import { baseCss, sceneHtml, titleCardHtml, watermarkHtml, bookHeaderHtml, overlayDecorHtml, fontFaceCss, flashCss, subtitleVarsCss } from './layout.js'
import { flashTimeline, DEFAULT_PARAMS } from './templateParams.js'
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
      // kenBurns（来自 material_animations[].material_type 含 'video'）和 motion.moves（来自 common_keyframes）
      // 是两个独立信号：草稿可能纯靠关键帧做运镜、同时只有文字动画（判成 kenBurns:'off'）。只看 kenBurns 会让
      // 这类草稿的 moves/photoScale 被整段丢弃——渲染器一直是静止画面，报告却照常说"运镜 N 段…按顺序循环套用"。
      // 所以只要 moves 非空就必须走运镜分支，不能被 kenBurns==='off' 挡住。
      if (p.body.kenBurns === 'subtle' || (p.motion?.moves?.length ?? 0) > 0) {
        // 剪映草稿提取到运镜序列时按顺序循环用（分镜数与原工程不一定一致，循环保节奏感）；否则维持原「轻推」
        // keyframes 非空时优先用草稿实测数值（照抄起止幅度、线性、不过冲）；为空回退预设招式。
        const kfs = p.motion?.keyframes ?? []
        if (kfs.length > 0) {
          const kf = kfs[((i - 1) % kfs.length + kfs.length) % kfs.length]
          motionLines.push(keyframeTween(kf, n, s.startMs, s.endMs))
        } else {
          const mv = p.motion?.moves?.length ? pickMove(i - 1, 0, p.motion.moves) : 'push-in'
          motionLines.push(moveTweens(mv, n, s.startMs, s.endMs, i === segs.length - 1, p.body.photoScale ?? 1.07))
        }
      }
      // 固定叠化转场：honour templateParams.transition.durationMs（原来是死数据，renderer 一直硬编码 0.72s 窗口）。
      // transition.durationMs 不是可选字段——parseTemplateParams 在没提取到时也会填 DEFAULT_PARAMS 的 400ms，
      // 所以不能拿它是否等于渲染器的 DEFAULT_TRANS_WINDOW(0.72) 来判断"是否真提取到"：那样几乎每个框架
      // （包括所有已有、未走本次改动前逻辑重新导出的框架）都会被判定为"不同于默认值"而被覆盖，
      // 把已上线框架的转场从 720ms 静默改成 400ms——这是本批次明确不允许的行为变化。
      // 正确判断依据是"是否不同于解析器自己的默认值"：只有 durationMs !== DEFAULT_PARAMS.transition.durationMs
      // 时才代表这是从工程里真提取出来的值，才覆盖；等于默认值时不传，交给 transTweens 走 0.72 的老默认。
      // 注意这只保证"未提取到转场时长的框架输出不变"——不是"已有框架输出不变"：凡是已经走过剪映导入页
      // 拿到真实提取值的框架（例如老样例解出的 500ms），这里会把它的叠化窗口从此前写死的 0.72s
      // 改成工程实测值，这正是本批次要接线的行为变化，只是此前的注释/设计文档把它错误地描述成了"不变"。
      // 不可避免的取舍：如果某个工程的转场恰好真的是 400ms（=解析器默认值），会被误判为"未提取"而不覆盖——
      // 没有额外的"是否真提取到"标记位可用，两害相权，保留"未提取到"这条路径的输出不变更重要。
      // 窗口同时不得超出当前段自身时长（否则叠化会拖进下一段边界），也不能低至 0（否则等价于硬切，没有叠化
      // 效果）——这里双向夹住，下限 0.05s。
      // 逐边界转场（阶段1）：bodyCycle 非空时优先用实测序列。
      // 第 1 个正片段对应「快闪→正片」那一刀，单独看 enterBodyHardCut（实测样例是硬切）；
      // 其后的边界循环套用 bodyCycle。两者分开，避免循环回绕时在正片中间冒出原片没有的硬切。
      const cyc = p.transition.bodyCycle ?? []
      if (cyc.length > 0) {
        if (i === 1) {
          if (p.transition.enterBodyHardCut === true) {
            // 硬切仍必须显式切换可见性：.scene 默认 opacity:0，「不生成 tween」会让正片第 1 段
            // 永远不出现、开场那张图一直挂着，直到第 2 段淡入才被盖掉。
            motionLines.push(hardCutTweens(n, s.startMs))
          } else {
            motionLines.push(transTweens('crossfade', n, s.startMs, cyc[0].durationMs / 1000))
          }
        } else {
          const b = cyc[((i - 2) % cyc.length + cyc.length) % cyc.length]
          motionLines.push(transTweens(b.renderType, n, s.startMs, Math.max(0.05, Math.min(b.durationMs / 1000, Math.max(0.05, sec(s.endMs - s.startMs))))))
        }
        return
      }
      const extractedWindowSec = p.transition.durationMs / 1000
      const segLenSec = sec(s.endMs - s.startMs)
      const transWindowSec = p.transition.durationMs !== DEFAULT_PARAMS.transition.durationMs
        ? Math.max(0.05, Math.min(extractedWindowSec, Math.max(0.05, segLenSec)))
        : undefined
      motionLines.push(transTweens('crossfade', n, s.startMs, transWindowSec))
    }
  })

  // 开场标题 + 快闪卡（落在第0段窗口内）
  const openHtml = openTitleHtml(p.open.titleText)
  const cardsHtml = flashCardsHtml(covers, p.flash.titleFontFamily, p.flash.scale)
  const flashTweens = [openTitleTweens(t.openEndMs), flashCardsTweens(covers, t, p.flash.bounceIn, p.flash.hardCut === true)].join('\n')

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
  // 水波纹：草稿把它压在快闪→正片那一刀上，与水滴音同时。offsetMs 是相对该刀口的偏移
  // （不是绝对时间——我们的分镜时长由 TTS 决定，与草稿不等长）。未提取到则整层不渲染。
  const rp = p.effects?.ripple
  const rippleHtmlStr = rp ? rippleHtml() : ''
  const rippleTweensStr = rp ? rippleTweens(t.flashEndMs + rp.offsetMs, rp.durationMs) : ''

  const allTweens = [motionLines.join('\n'), flashTweens, bookHeaderTweens, capTweenParts.join('\n'), rippleTweensStr].filter(Boolean).join('\n')
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
${flashCss()}${rp ? '\n' + rippleCss() : ''}${gradeStyleBlock}
</style></head>
<body>
<main id="root" data-composition-id="main" data-start="0" data-duration="${lastEndSec}" data-width="${width}" data-height="${height}">
${scenesHtml}
${openingShatterHtml}
${rippleHtmlStr}
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
