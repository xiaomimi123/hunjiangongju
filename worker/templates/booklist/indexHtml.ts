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

export function renderIndexHtml(data: BodyData): string {
  const { width, height } = data.size
  const segs = [...data.segments].sort((a, b) => a.startMs - b.startMs)
  if (segs.length === 0) throw new Error('renderIndexHtml: segments 为空')
  const lastEndSec = sec(Math.max(...segs.map((s) => s.endMs)))

  // 每段一个 .scene.sN（内含 .photo 背景图）+ 一个字幕 .cap.capN
  const scenesHtml = segs
    .map((s, i) => {
      const n = i + 1
      const img = data.images[s.imageIndex]?.src ?? data.images[i]?.src ?? ''
      return (
        `    <div class="scene s${n}" data-layout-ignore>\n` +
        `      <div class="photo" style="background-image:url('${esc(img)}')"></div>\n` +
        `    </div>`
      )
    })
    .join('\n')

  const capsHtml = segs
    .map((s, i) => {
      const n = i + 1
      return `    <div class="cap cap${n}" data-layout-ignore>${esc(s.subtitle)}</div>`
    })
    .join('\n')

  // GSAP 时间线：每段 缓推近 + crossfade + 字幕 reveal，位置用 startMs/1000
  const tweens = segs
    .map((s, i) => {
      const n = i + 1
      const startSec = sec(s.startMs)
      const endSec = sec(s.endMs)
      const segLenSec = Math.max(0.1, sec(s.endMs - s.startMs))
      const pushDur = Math.round((segLenSec + 1.2) * 1000) / 1000
      const lines: string[] = []
      // 缓推近（Ken-Burns）
      lines.push(
        `  tl.fromTo('.s${n} .photo', { scale: 1.035 }, { scale: 1.105, duration: ${pushDur}, ease: 'sine.inOut' }, ${startSec});`,
      )
      // crossfade：本段淡入 + 上一段同刻淡出
      lines.push(
        `  tl.fromTo('.s${n}', { opacity: 0 }, { opacity: 1, duration: 0.72, ease: 'sine.inOut' }, ${startSec});`,
      )
      if (i > 0) {
        lines.push(`  tl.to('.s${i}', { opacity: 0, duration: 0.72, ease: 'sine.inOut' }, ${startSec});`)
      }
      // 字幕 reveal → hold → 收起
      lines.push(
        `  tl.fromTo('.cap${n}', { opacity: 0, y: 18 }, { opacity: 1, y: 0, duration: 0.3 }, ${startSec});`,
      )
      lines.push(`  tl.set('.cap${n}', { opacity: 0 }, ${endSec});`)
      return lines.join('\n')
    })
    .join('\n')

  const hasSubtitle = data.overlay.subtitle && data.overlay.subtitle.trim().length > 0
  const titleCardHtml =
    `    <div class="title-card" data-layout-ignore>\n` +
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
    /* 常驻标题卡 */
    .title-card {
      position: absolute; top: 48px; left: 0; right: 0;
      text-align: center; padding: 0 40px; opacity: 1; z-index: 20;
      text-shadow: 0 2px 12px rgba(0,0,0,0.65);
    }
    .tc-title { color: #fff; font-size: 46px; font-weight: 800; line-height: 1.2; }
    .tc-subtitle { color: #f0e6d2; font-size: 26px; font-weight: 500; margin-top: 10px; }
    /* 字幕层 */
    .cap {
      position: absolute; left: 40px; right: 40px; bottom: 150px;
      text-align: center; color: #fff; font-size: 34px; font-weight: 700;
      line-height: 1.4; opacity: 0; z-index: 15;
      text-shadow: 0 2px 10px rgba(0,0,0,0.8);
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
${capsHtml}
${titleCardHtml}
${watermarkHtml}
  </main>
  <script src="gsap.min.js"></script>
  <script>
    window.__timelines = window.__timelines || {};
    var tl = gsap.timeline({ paused: true });
${tweens}
    window.__timelines["main"] = tl;
  </script>
</body>
</html>
`
}
