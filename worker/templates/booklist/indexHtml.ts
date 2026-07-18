// 自研 HyperFrames「书单号」正文模板 codegen（reference §1/§6 契约）
// 生成自包含 index.html：<main data-composition-id> + 常驻标题卡/水印 +
// 图片轮播（缓推近）+ 字幕层 + paused GSAP timeline on window.__timelines["main"].
// 画布 720×960 @30fps（fps 由 hyperframes --quality standard 决定，不在 HTML 中）。

export interface BodyOverlay {
  /** 标题卡主标题（书名） */
  title: string
  /** 标题卡副标题（作者/著等），可空 */
  subtitle: string
  /** 常驻水印（账号名），可空 */
  watermark: string
}

export interface BodyImage {
  /** 相对项目目录的图片路径，如 media/01.png */
  src: string
}

export interface BodySegment {
  seqNo: number
  startMs: number
  endMs: number
  /** 该段字幕文本（脚本原文，字幕真源） */
  subtitle: string
  /** 对应 images 下标 */
  imageIndex: number
  /** 书单模式：该段所属书名（不含书名号），驱动常驻书名头；缺省时退回 M1 开场标题卡行为 */
  bookTitle?: string
  /** 书单模式：该段所属书作者，随书名头展示 */
  bookAuthor?: string
  /** 双语字幕：该段字幕的英文翻译行，缺省时只渲染中文字幕（M1 行为） */
  subtitleEn?: string
}

export interface BodyData {
  size: { width: number; height: number }
  overlay: BodyOverlay
  images: BodyImage[]
  segments: BodySegment[]
}

/** HTML 文本转义，防止字幕/标题里的特殊字符破坏结构 */
function esc(s: string): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** ms → 秒（保留 3 位小数，去掉浮点尾巴） */
function sec(ms: number): number {
  return Math.round((ms / 1000) * 1000) / 1000
}

/**
 * 碎片网格：把一张图切成 cols×rows 个 .shard 绝对定位块，每块用
 * background-size=画布尺寸 + background-position=负偏移 精确显示自己那一格，
 * 拼在一起视觉上等于整张图。用于「玻璃碎片开场」与「碎片/马赛克转场」共用。
 */
function shardGrid(opts: {
  containerClass: string
  imgSrc: string
  cols: number
  rows: number
  width: number
  height: number
  startScattered?: boolean // true: 每片把「打散」的初始 transform/opacity 直接烘焙进内联样式，
  // GSAP 只需 to 归位——避免 function-based from 值在 HyperFrames 无头 seek 下不生效导致动画失效。
}): string {
  const { containerClass, imgSrc, cols, rows, width, height, startScattered } = opts
  const cellW = width / cols
  const cellH = height / rows
  const shards: string[] = []
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const idx = r * cols + c
      const left = Math.round(c * cellW)
      const top = Math.round(r * cellH)
      const w = Math.round(cellW) + 1 // +1 兜底像素缝隙
      const h = Math.round(cellH) + 1
      let scatter = ''
      if (startScattered) {
        const dx = Math.round(Math.sin(idx * 1.7) * 240 + (idx % 2 === 0 ? 70 : -70))
        const dy = Math.round(Math.cos(idx * 2.1) * 200 - 30)
        const dr = Math.round(Math.sin(idx * 3.3) * 55)
        scatter = `transform:translate(${dx}px,${dy}px) rotate(${dr}deg) scale(1.15);opacity:0.15;`
      }
      shards.push(
        `      <div class="shard" style="left:${left}px;top:${top}px;width:${w}px;height:${h}px;` +
          `background-image:url('${esc(imgSrc)}');background-size:${width}px ${height}px;` +
          `background-position:-${left}px -${top}px;${scatter}"></div>`,
      )
    }
  }
  return `    <div class="${containerClass}" data-layout-ignore>\n${shards.join('\n')}\n    </div>`
}

export function renderIndexHtml(data: BodyData): string {
  const { width, height } = data.size
  const segs = [...data.segments].sort((a, b) => a.startMs - b.startMs)
  if (segs.length === 0) throw new Error('renderIndexHtml: segments 为空')
  const lastEndSec = sec(Math.max(...segs.map((s) => s.endMs)))

  const imgFor = (s: BodySegment, i: number) => data.images[s.imageIndex]?.src ?? data.images[i]?.src ?? ''

  // 每段一个 .scene.sN（内含 .photo 背景图）+ 一个字幕 .cap.capN
  const scenesHtml = segs
    .map((s, i) => {
      const n = i + 1
      const img = imgFor(s, i)
      return (
        `    <div class="scene s${n}" data-layout-ignore>\n` +
        `      <div class="photo" style="background-image:url('${esc(img)}')"></div>\n` +
        `    </div>`
      )
    })
    .join('\n')

  // 玻璃碎片开场：仅首场景，4×5=20 片碎片覆盖整个画布，t=0 起 stagger 归位
  const openingShatterHtml = shardGrid({
    containerClass: 'shatter s1shatter',
    imgSrc: imgFor(segs[0], 0),
    cols: 4,
    rows: 5,
    width,
    height,
    startScattered: true,
  })

  // 碎片/马赛克转场：每个场景边界叠一层「上一场景」的碎片网格，随 0.72s crossfade 窗口碎裂散开
  const transShattersHtml = segs
    .slice(1)
    .map((_s, idx) => {
      const i = idx + 1 // segs 下标（当前场景），上一场景为 i-1
      const n = i + 1
      return shardGrid({
        containerClass: `tshatter ts${n}`,
        imgSrc: imgFor(segs[i - 1], i - 1),
        cols: 3,
        rows: 3,
        width,
        height,
      })
    })
    .join('\n')

  // 结尾定格强调：常驻暗角层，仅末段窗口内淡入
  const vignetteHtml = `    <div class="vignette" data-layout-ignore></div>`

  // 双语字幕：subtitleEn 存在时中文 + 英文两行；缺省时只渲染中文（M1 行为）
  const capsHtml = segs
    .map((s, i) => {
      const n = i + 1
      const en = (s.subtitleEn ?? '').trim()
      const enLine = en ? `\n      <div class="cap-en">${esc(en)}</div>` : ''
      return (
        `    <div class="cap cap${n}" data-layout-ignore>\n` +
        `      <div class="cap-zh">${esc(s.subtitle)}</div>${enLine}\n` +
        `    </div>`
      )
    })
    .join('\n')

  // GSAP 时间线：每段 缓推近 + crossfade + 字幕 reveal，位置用 startMs/1000；
  // 所有新增特效都叠在原有 startMs/endMs 时间窗之上，不新增时长、不挪动分段起止点。
  const tweens = segs
    .map((s, i) => {
      const n = i + 1
      const startSec = sec(s.startMs)
      const endSec = sec(s.endMs)
      const segLenSec = Math.max(0.1, sec(s.endMs - s.startMs))
      const isLast = i === segs.length - 1
      // 结尾定格强调：末段缓推近目标幅度更大，制造「慢慢逼近金句」的收束感
      const scaleTo = isLast ? 1.16 : 1.105
      const pushDur = Math.round((segLenSec + 1.2) * 1000) / 1000
      const lines: string[] = []
      // 缓推近（Ken-Burns）
      lines.push(
        `  tl.fromTo('.s${n} .photo', { scale: 1.035 }, { scale: ${scaleTo}, duration: ${pushDur}, ease: 'sine.inOut' }, ${startSec});`,
      )
      // crossfade：首段从 0s 起直接可见（避免开场淡入露出深色底=黑屏），后续段淡入 + 上一段同刻淡出
      if (i === 0) {
        lines.push(`  tl.set('.s${n}', { opacity: 1 }, 0);`)
        // 玻璃碎片开场：t=0 起显示「打散的碎片」(可见、大幅错位/旋转)，~0.7s 内飞回归位拼成整图。
        // 真实 .photo 在拼合完成前隐藏——否则完整图盖住碎片层，动画看不出效果——0.8s 淡入接手，碎片层随即淡出。
        // 偏移量由碎片下标 sin/cos 推导，纯函数、可复现，不依赖 Math.random。
        lines.push(`  tl.set('.s1 .photo', { opacity: 0 }, 0);`)
        // 碎片初始「打散」状态已烘焙进各片内联 transform/opacity（见 shardGrid startScattered），
        // 这里只用字面量 to 归位——不用 function-based 值，确保 HyperFrames 无头 seek 下动画真渲染。
        lines.push(
          `  tl.to('.s1shatter .shard', { x: 0, y: 0, rotation: 0, scale: 1, opacity: 1, duration: 0.65, ease: 'power3.out', stagger: { amount: 0.45, from: 'center' } }, 0);`,
        )
        lines.push(`  tl.to('.s1 .photo', { opacity: 1, duration: 0.2, ease: 'sine.inOut' }, 0.82);`)
        lines.push(`  tl.to('.s1shatter', { opacity: 0, duration: 0.25, ease: 'sine.inOut' }, 0.88);`)
      } else {
        lines.push(
          `  tl.fromTo('.s${n}', { opacity: 0 }, { opacity: 1, duration: 0.72, ease: 'sine.inOut' }, ${startSec});`,
        )
        lines.push(`  tl.to('.s${i}', { opacity: 0, duration: 0.72, ease: 'sine.inOut' }, ${startSec});`)
        // 碎片/马赛克转场：上一场景的碎片网格层与 crossfade 同刻显形，随后 0.5s 内散开/旋转/淡出，
        // 露出下方同时淡入的新场景；整个效果落在既有 0.72s crossfade 窗口内，不占用额外时长。
        const hideAtSec = Math.round((startSec + 0.72) * 1000) / 1000
        lines.push(`  tl.set('.ts${n}', { opacity: 1 }, ${startSec});`)
        // 转场：上一场景的碎片层用「统一字面量 + stagger」整体放大上飘旋转淡出（碎裂消散波），
        // 不用 function-based 值，确保 HyperFrames 下真渲染。
        lines.push(
          `  tl.to('.ts${n} .shard', { scale: 1.3, y: -50, rotation: 12, opacity: 0, duration: 0.5, ease: 'power1.in', stagger: { amount: 0.26, from: 'edges' } }, ${startSec});`,
        )
        lines.push(`  tl.set('.ts${n}', { opacity: 0 }, ${hideAtSec});`)
      }
      // 字幕 reveal → hold → 收起
      lines.push(
        `  tl.fromTo('.cap${n}', { opacity: 0, y: 18 }, { opacity: 1, y: 0, duration: 0.3 }, ${startSec});`,
      )
      lines.push(`  tl.set('.cap${n}', { opacity: 0 }, ${endSec});`)
      // 结尾定格强调：末段窗口内暗角渐入，衬托金句收尾（时长=段自身长度，不外溢）
      if (isLast) {
        lines.push(
          `  tl.fromTo('.vignette', { opacity: 0 }, { opacity: 0.55, duration: ${segLenSec}, ease: 'sine.in' }, ${startSec});`,
        )
      }
      return lines.join('\n')
    })
    .join('\n')

  // 书单模式：任一段带 bookTitle 时启用「常驻书名头」（取代开场标题卡）；
  // 连续同书名的段落合并为同一个「书名头运行段」，避免同书切段时闪烁。
  const hasBookMode = segs.some((s) => (s.bookTitle ?? '').trim().length > 0)

  interface BookRun {
    title: string
    author?: string
    startIdx: number
    endIdx: number
  }
  const bookRuns: BookRun[] = []
  if (hasBookMode) {
    segs.forEach((s, i) => {
      const title = (s.bookTitle ?? '').trim()
      if (!title) return
      const prev = bookRuns[bookRuns.length - 1]
      if (prev && prev.title === title && prev.endIdx === i - 1) {
        prev.endIdx = i
      } else {
        bookRuns.push({ title, author: s.bookAuthor, startIdx: i, endIdx: i })
      }
    })
  }

  const bookHeadersHtml = bookRuns
    .map((r, ri) => {
      const n = ri + 1
      const authorLine =
        r.author && r.author.trim().length > 0
          ? `\n      <div class="bh-author">${esc(r.author)} / 著</div>`
          : ''
      return (
        `    <div class="book-header bh${n}" data-layout-ignore>\n` +
        `      <div class="bh-title">《${esc(r.title)}》</div>${authorLine}\n` +
        `    </div>`
      )
    })
    .join('\n')

  const bookHeaderTweens = bookRuns
    .map((r, ri) => {
      const n = ri + 1
      const startSec = sec(segs[r.startIdx].startMs)
      const lines: string[] = []
      if (r.startIdx === 0) {
        // 首个书名头从 0s 起直接可见，与首段场景同步（避免开场空白）
        lines.push(`  tl.set('.bh${n}', { opacity: 1 }, 0);`)
      } else {
        lines.push(
          `  tl.fromTo('.bh${n}', { opacity: 0 }, { opacity: 1, duration: 0.5, ease: 'sine.inOut' }, ${startSec});`,
        )
        // 与上一个书名头同刻淡出（上一运行段编号 = ri，因 n = ri + 1）
        lines.push(`  tl.to('.bh${ri}', { opacity: 0, duration: 0.5, ease: 'sine.inOut' }, ${startSec});`)
      }
      return lines.join('\n')
    })
    .join('\n')

  const allTweens = bookHeaderTweens ? `${tweens}\n${bookHeaderTweens}` : tweens

  const hasSubtitle = data.overlay.subtitle && data.overlay.subtitle.trim().length > 0
  // M1 兼容：仅当没有任何段落带 bookTitle 时才渲染开场标题卡；书单模式由常驻书名头取代
  const titleCardHtml = hasBookMode
    ? ''
    : `    <div class="title-card" data-layout-ignore>\n` +
      `      <div class="tc-title">${esc(data.overlay.title)}</div>\n` +
      (hasSubtitle ? `      <div class="tc-subtitle">${esc(data.overlay.subtitle)}</div>\n` : '') +
      `    </div>`

  const watermarkHtml = data.overlay.watermark
    ? `    <div class="watermark" data-layout-ignore>${esc(data.overlay.watermark)}</div>`
    : ''

  return `<!doctype html>
<html lang="zh">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=${width}, height=${height}" />
  <title>booklist body</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body {
      width: ${width}px; height: ${height}px;
      background: #0d0d10; overflow: hidden;
      font-family: "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
    }
    #root { position: relative; width: ${width}px; height: ${height}px; overflow: hidden; }
    .scene {
      position: absolute; inset: 0; opacity: 0; overflow: hidden;
    }
    .scene .photo {
      position: absolute; inset: -22px;
      background-size: cover; background-position: center;
      will-change: transform;
    }
    /* 玻璃碎片开场 / 碎片马赛克转场：共用的碎片网格层（在场景之上、字幕之下） */
    .shatter, .tshatter {
      position: absolute; inset: 0; z-index: 10; pointer-events: none;
    }
    .shard {
      position: absolute; overflow: hidden;
      will-change: transform, opacity;
    }
    /* 结尾定格强调：暗角渐入烘托末段金句（在场景/碎片层之上、字幕之下） */
    .vignette {
      position: absolute; inset: 0; z-index: 12; opacity: 0; pointer-events: none;
      background: radial-gradient(ellipse at center, rgba(0,0,0,0) 42%, rgba(0,0,0,0.72) 100%);
    }
    /* 常驻标题卡 */
    .title-card {
      position: absolute; top: 48px; left: 0; right: 0;
      text-align: center; padding: 0 40px; opacity: 1; z-index: 20;
      text-shadow: 0 2px 12px rgba(0,0,0,0.65);
    }
    .tc-title { color: #fff; font-size: 46px; font-weight: 800; line-height: 1.2; }
    .tc-subtitle { color: #f0e6d2; font-size: 26px; font-weight: 500; margin-top: 10px; }
    /* 书单模式：常驻书名头（随段切换，同书连续段不重复渲染） */
    .book-header {
      position: absolute; top: 48px; left: 0; right: 0;
      text-align: center; padding: 0 40px; opacity: 0; z-index: 20;
      text-shadow: 0 2px 12px rgba(0,0,0,0.65);
    }
    .bh-title {
      color: #fff; font-size: 46px; font-weight: 800; line-height: 1.2;
      font-family: "Songti SC", "STSong", "SimSun", serif;
    }
    .bh-author { color: #f2b84b; font-size: 26px; font-weight: 600; margin-top: 10px; }
    /* 字幕层：下三分，中文粗体 + 英文（缺省时只渲染中文，M1 行为） */
    .cap {
      position: absolute; left: 40px; right: 40px; bottom: 150px;
      text-align: center; opacity: 0; z-index: 15;
    }
    .cap-zh {
      color: #fff; font-size: 34px; font-weight: 700; line-height: 1.4;
      text-shadow: 0 2px 10px rgba(0,0,0,0.8);
    }
    .cap-en {
      color: #f0e6d2; font-size: 22px; font-style: italic; font-weight: 500;
      line-height: 1.3; margin-top: 8px;
      text-shadow: 0 2px 8px rgba(0,0,0,0.7);
      font-family: "Bradley Hand", "Segoe Script", "Snell Roundhand", cursive;
    }
    /* 常驻水印 */
    .watermark {
      position: absolute; left: 0; right: 0; bottom: 56px;
      text-align: center; color: rgba(255,255,255,0.82); font-size: 24px;
      font-weight: 600; opacity: 1; z-index: 20;
      text-shadow: 0 2px 8px rgba(0,0,0,0.6);
    }
  </style>
</head>
<body>
  <main id="root" data-composition-id="main" data-start="0" data-duration="${lastEndSec}" data-width="${width}" data-height="${height}">
${scenesHtml}
${openingShatterHtml}
${transShattersHtml}
${vignetteHtml}
${capsHtml}
${bookHeadersHtml}
${titleCardHtml}
${watermarkHtml}
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
