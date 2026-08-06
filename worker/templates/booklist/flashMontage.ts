// 书单快闪：开场「今天分享的是」标题 + 逐本书封面(底图+叠书名)极速闪过。全字面量 seek-safe。
import { esc, sec } from './util.js'
import type { FlashTimeline } from './templateParams.js'

export interface FlashCover { title: string; author?: string; coverSrc: string }

export function openTitleHtml(titleText: string): string {
  return `    <div class="flash-open" data-layout-ignore>\n      <div class="fo-kicker"></div>\n      <div class="fo-title">${esc(titleText)}</div>\n    </div>`
}

export function openTitleTweens(openEndMs: number): string {
  const end = sec(openEndMs)
  const out = Math.max(0, Math.round((openEndMs - 300) / 1000 * 1000) / 1000)
  return [
    `  tl.fromTo('.flash-open', { opacity: 0, y: 20 }, { opacity: 1, y: 0, duration: 0.4, ease: 'power2.out' }, 0);`,
    `  tl.to('.flash-open', { opacity: 0, duration: 0.25, ease: 'sine.in' }, ${out});`,
    `  tl.set('.flash-open', { opacity: 0 }, ${end});`,
  ].join('\n')
}

// coverScale：从剪映草稿提取的 flash.scale（Task 4），静态 CSS transform 烘焙在 .fc-cover 上
// （该元素本身无 transform；GSAP 的 bounce 只动画父级 .flashcard 的 scale/opacity，两者独立叠加、seek-safe）。
// 缺省或恰为 1 时不输出任何 transform，保证零回归。coverRelativeScale 的提取口径只会把原始缩放往下调，
// 所以 <1 的值是可达的；.fc-cover 是 position:absolute;inset:0;background-size:cover，缩小反而会露出
// overflow:hidden 的 .flashcard 卡片下方的场景——只在 >1（放大不露底）时才输出 transform。
export function flashCardsHtml(covers: FlashCover[], titleFontFamily: string, coverScale?: number): string {
  const scaleStyle = typeof coverScale === 'number' && coverScale > 1 ? `;transform:scale(${coverScale})` : ''
  return covers
    .map((c, i) => {
      const n = i + 1
      const author = c.author && c.author.trim() ? `\n        <div class="fc-author">${esc(c.author)}</div>` : ''
      return (
        `    <div class="flashcard fc${n}" data-layout-ignore>\n` +
        `      <div class="fc-cover" style="background-image:url('${esc(c.coverSrc)}')${scaleStyle}"></div>\n` +
        `      <div class="fc-title" style="font-family:'${esc(titleFontFamily)}'">《${esc(c.title)}》</div>${author}\n` +
        `    </div>`
      )
    })
    .join('\n')
}

export function flashCardsTweens(covers: FlashCover[], t: FlashTimeline, bounceIn: boolean): string {
  const lines: string[] = []
  covers.forEach((_c, i) => {
    const n = i + 1
    const at = sec(t.openEndMs + i * t.perClipMs)
    const off = sec(t.openEndMs + (i + 1) * t.perClipMs)
    const from = bounceIn ? `{ opacity: 0, scale: 0.86 }` : `{ opacity: 0 }`
    const to = bounceIn ? `opacity: 1, scale: 1` : `opacity: 1`
    lines.push(`  tl.fromTo('.fc${n}', ${from}, { ${to}, duration: 0.12, ease: 'back.out(2)' }, ${at});`)
    lines.push(`  tl.set('.fc${n}', { opacity: 0 }, ${off});`)
  })
  return lines.join('\n')
}
