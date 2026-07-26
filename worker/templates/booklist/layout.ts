// 结构 CSS（引用 theme 的 CSS 变量）与 HTML 片段构造。美术 token 全部来自 var(--...)。
import { esc } from './util.js'
import { hasGrain, type PresetId } from './theme.js'

export function baseCss(_preset: PresetId): string {
  return `    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body {
      width: 720px; height: 960px; background: var(--bg); overflow: hidden;
      font-family: var(--font-body);
    }
    #root { position: relative; width: 720px; height: 960px; overflow: hidden; background: var(--bg); }
    .scene { position: absolute; inset: 0; opacity: 0; overflow: hidden; }
    /* 背景模糊填充：非等比图不再露底，用同图放大模糊铺底 */
    .scene .bg-fill {
      position: absolute; inset: -40px; background-size: cover; background-position: center;
      filter: blur(28px) brightness(0.6); transform: scale(1.1);
    }
    .scene .photo {
      position: absolute; inset: -30px; background-size: contain; background-repeat: no-repeat;
      background-position: center; will-change: transform;
    }
    .shatter, .tshatter { position: absolute; inset: 0; z-index: 10; pointer-events: none; }
    .shard { position: absolute; overflow: hidden; will-change: transform, opacity; }
    /* 字幕压暗底：保证任意底图上字幕清晰 */
    .scrim {
      position: absolute; left: 0; right: 0; bottom: 0; height: 340px; z-index: 13;
      background: linear-gradient(to top, var(--scrim) 0%, rgba(0,0,0,0) 100%); pointer-events: none;
    }
    .vignette {
      position: absolute; inset: 0; z-index: 12; opacity: 0; pointer-events: none;
      background: radial-gradient(ellipse at center, rgba(0,0,0,0) 42%, rgba(0,0,0,0.72) 100%);
    }
    /* 颗粒层：仅带 grain 的预设渲染，增质感 */
    .grain {
      position: absolute; inset: 0; z-index: 14; opacity: 0.06; pointer-events: none; mix-blend-mode: overlay;
      background-image: radial-gradient(rgba(255,255,255,0.9) 0.5px, transparent 0.5px);
      background-size: 3px 3px;
    }
    .title-card {
      position: absolute; top: 48px; left: 0; right: 0; text-align: center; padding: 0 40px;
      opacity: 1; z-index: 20; text-shadow: 0 2px 12px rgba(0,0,0,0.65);
    }
    .tc-title { color: var(--ink); font-size: var(--fs-title); font-weight: 800; line-height: 1.2; font-family: var(--font-title); }
    .tc-subtitle { color: var(--ink-dim); font-size: 26px; font-weight: 500; margin-top: 10px; }
    .book-header {
      position: absolute; top: 48px; left: 0; right: 0; text-align: center; padding: 0 40px;
      opacity: 0; z-index: 20; text-shadow: 0 2px 12px rgba(0,0,0,0.65);
    }
    .bh-kicker { display: inline-block; width: 46px; height: 4px; background: var(--accent); border-radius: 2px; margin-bottom: 14px; }
    .bh-title { color: var(--ink); font-size: var(--fs-book); font-weight: 800; line-height: 1.2; font-family: var(--font-title); }
    .bh-author { color: var(--accent); font-size: 26px; font-weight: 600; margin-top: 10px; }
    .cap { position: absolute; left: 40px; right: 40px; bottom: var(--cap-bottom, 150px); text-align: center; opacity: 0; z-index: 15; }
    .cap-zh { color: var(--cap-color, var(--ink)); font-size: var(--fs-cap-zh); font-weight: 700; line-height: 1.4; text-shadow: 0 2px 10px rgba(0,0,0,0.8); font-family: var(--cap-font, inherit); }
    .cap-en { color: var(--ink-dim); font-size: var(--fs-cap-en); font-style: italic; font-weight: 500; line-height: 1.3; margin-top: 8px; text-shadow: 0 2px 8px rgba(0,0,0,0.7); font-family: var(--font-en); }
    .watermark {
      position: absolute; left: 0; right: 0; bottom: 56px; text-align: center;
      color: rgba(255,255,255,0.82); font-size: 24px; font-weight: 600; opacity: 1; z-index: 20;
      text-shadow: 0 2px 8px rgba(0,0,0,0.6);
    }`
}

export function sceneHtml(n: number, imgSrc: string): string {
  return (
    `    <div class="scene s${n}" data-layout-ignore>\n` +
    `      <div class="bg-fill" style="background-image:url('${esc(imgSrc)}')"></div>\n` +
    `      <div class="photo" style="background-image:url('${esc(imgSrc)}')"></div>\n` +
    `    </div>`
  )
}

export function titleCardHtml(title: string, subtitle: string): string {
  const sub = subtitle && subtitle.trim() ? `\n      <div class="tc-subtitle">${esc(subtitle)}</div>` : ''
  return (
    `    <div class="title-card" data-layout-ignore>\n` +
    `      <div class="tc-title">${esc(title)}</div>${sub}\n` +
    `    </div>`
  )
}

export function watermarkHtml(text: string): string {
  if (!text) return ''
  return `    <div class="watermark" data-layout-ignore>${esc(text)}</div>`
}

export function bookHeaderHtml(n: number, title: string, author?: string): string {
  const authorLine = author && author.trim() ? `\n      <div class="bh-author">${esc(author)} / 著</div>` : ''
  return (
    `    <div class="book-header bh${n}" data-layout-ignore>\n` +
    `      <div class="bh-kicker"></div>\n` +
    `      <div class="bh-title">《${esc(title)}》</div>${authorLine}\n` +
    `    </div>`
  )
}

export function overlayDecorHtml(preset: PresetId): string {
  const grain = hasGrain(preset) ? `\n    <div class="grain" data-layout-ignore></div>` : ''
  return `    <div class="vignette" data-layout-ignore></div>${grain}`
}

// 本地 @font-face（self-contained：字体文件随 hf 项目拷贝，相对路径引用；缺文件时浏览器回退系统字体）
export function fontFaceCss(fonts: { family: string; url: string }[]): string {
  if (!fonts.length) return ''
  return fonts
    .map((f) => `    @font-face { font-family: '${f.family}'; src: url('${f.url}'); font-display: swap; }`)
    .join('\n')
}

// 快闪结构 CSS（开场标题 + 书封卡：满屏封面底图 + 居中大书名）
export function flashCss(): string {
  return `    .flash-open { position:absolute; top:44%; left:0; right:0; text-align:center; z-index:22; opacity:0; padding:0 40px; text-shadow:0 2px 14px rgba(0,0,0,.7); }
    .flash-open .fo-kicker { display:inline-block; width:54px; height:4px; background:var(--accent); border-radius:2px; margin-bottom:16px; }
    .flash-open .fo-title { color:var(--ink); font-size:56px; font-weight:800; font-family:var(--font-title); line-height:1.2; }
    .flashcard { position:absolute; inset:0; z-index:18; opacity:0; overflow:hidden; }
    .flashcard .fc-cover { position:absolute; inset:0; background-size:cover; background-position:center; }
    .flashcard .fc-title { position:absolute; left:40px; right:40px; top:50%; transform:translateY(-50%); text-align:center; color:#fff; font-size:60px; font-weight:800; line-height:1.15; text-shadow:0 3px 18px rgba(0,0,0,.85); }
    .flashcard .fc-author { position:absolute; left:0; right:0; top:62%; text-align:center; color:var(--accent); font-size:28px; font-weight:600; text-shadow:0 2px 10px rgba(0,0,0,.8); }`
}

// 用参数覆盖字幕相关 CSS 变量（注入到 :root 之后，优先级更高的第二个 :root）
export function subtitleVarsCss(body: { subtitleColor: string; subtitlePosY: number; subtitleFontFamily: string }): string {
  // subtitlePosY: 0..1 归一化(0.78≈下三分) → bottom = (1 - posY) * 960
  const bottom = Math.round((1 - body.subtitlePosY) * 960)
  return `    :root { --cap-color: ${body.subtitleColor}; --cap-bottom: ${bottom}px; --cap-font: '${body.subtitleFontFamily}', var(--font-body); }`
}
