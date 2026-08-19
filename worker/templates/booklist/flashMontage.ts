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

// hardCut：快闪卡之间瞬时切换，不做任何淡入。
// 依据实测——原剪映工程的快闪段边界上没有任何转场素材（转场只挂在正片那 3 个边界上），
// 也没有对应的入场动画，就是硬切。而默认的 0.12s 淡入放在一张只有 150-250ms 的卡上，
// 超过一半的生命花在渐显，节奏感被抹软。hardCut 与 bounceIn 互斥：硬切下不存在"入场过程"，
// 弹入无处可施，故忽略 bounceIn。
// 缺省 false，保证未接入草稿时间轴的老框架输出逐字节不变。
//
// 【产品决定，勿擅自改默认值】2026-08-19：渲出淡入版与硬切版对比样片后，用户选择**保留淡入**。
// 原剪映工程的快闪边界确实是硬切，我们主动不复刻——因为我们的快闪卡是 AI 生成书封，与原片
// 真实素材质感不同，硬切观感未必更好。所以本参数保留能力但默认关闭，也**不**从草稿自动判定
// 该硬切还是淡入（那会自动切到用户不要的效果）。见
// docs/superpowers/specs/2026-08-19-timeline-transitions-motion-design.md §二D1。
export function flashCardsTweens(covers: FlashCover[], t: FlashTimeline, bounceIn: boolean, hardCut = false): string {
  const lines: string[] = []
  covers.forEach((_c, i) => {
    const n = i + 1
    const at = sec(t.openEndMs + i * t.perClipMs)
    const off = sec(t.openEndMs + (i + 1) * t.perClipMs)
    if (hardCut) {
      lines.push(`  tl.set('.fc${n}', { opacity: 1 }, ${at});`)
      lines.push(`  tl.set('.fc${n}', { opacity: 0 }, ${off});`)
      return
    }
    const from = bounceIn ? `{ opacity: 0, scale: 0.86 }` : `{ opacity: 0 }`
    const to = bounceIn ? `opacity: 1, scale: 1` : `opacity: 1`
    lines.push(`  tl.fromTo('.fc${n}', ${from}, { ${to}, duration: 0.12, ease: 'back.out(2)' }, ${at});`)
    lines.push(`  tl.set('.fc${n}', { opacity: 0 }, ${off});`)
  })
  return lines.join('\n')
}
