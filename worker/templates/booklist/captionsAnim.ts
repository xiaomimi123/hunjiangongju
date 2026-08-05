// 字幕节拍入场库。每拍一个 .capN 单元；入场型按 index 轮换。全部 seek-safe。
import { esc, sec } from './util.js'

export type EntranceId = 'fade-up' | 'mask-reveal' | 'char-stagger' | 'slide-in'
// char-stagger 的无头 seek 兼容性由集成验证（Task 8）确认；若失效从此数组移除即完成降级。
export const ENTRANCES: EntranceId[] = ['fade-up', 'mask-reveal', 'char-stagger', 'slide-in']

export function pickEntrance(capIndex: number, offset: number, fixed?: string): EntranceId {
  if (fixed && (ENTRANCES as string[]).includes(fixed)) return fixed as EntranceId
  return ENTRANCES[(((capIndex + offset) % ENTRANCES.length) + ENTRANCES.length) % ENTRANCES.length]
}

export function captionUnit(p: {
  n: number
  entrance: EntranceId
  zh: string
  en?: string
  startMs: number
  endMs: number
}): { html: string; tweens: string } {
  const { n, entrance, zh, en, startMs, endMs } = p
  const s = sec(startMs)
  const e = sec(endMs)
  const enLine = en && en.trim() ? `\n      <div class="cap-en">${esc(en.trim())}</div>` : ''

  // char-stagger 需要逐字 span，其余用整块 .cap-zh
  const zhHtml =
    entrance === 'char-stagger'
      ? `<div class="cap-zh">${Array.from(zh)
          .map((ch) => `<span class="ch" style="opacity:0;transform:translateY(10px);display:inline-block">${esc(ch)}</span>`)
          .join('')}</div>`
      : `<div class="cap-zh">${esc(zh)}</div>`

  const html =
    `    <div class="cap cap${n}" data-layout-ignore>\n` +
    `      ${zhHtml}${enLine}\n` +
    `    </div>`

  const sel = `'.cap${n}'`
  const inLines: string[] = []
  switch (entrance) {
    case 'fade-up':
      inLines.push(`  tl.fromTo(${sel}, { opacity: 0, y: 14 }, { opacity: 1, y: 0, duration: 0.22, ease: 'power2.out' }, ${s});`)
      break
    case 'mask-reveal':
      inLines.push(`  tl.set(${sel}, { opacity: 1 }, ${s});`)
      inLines.push(`  tl.fromTo(${sel}, { clipPath: 'inset(0 100% 0 0)' }, { clipPath: 'inset(0 0% 0 0)', duration: 0.3, ease: 'power2.out' }, ${s});`)
      break
    case 'slide-in':
      inLines.push(`  tl.fromTo(${sel}, { opacity: 0, x: -40 }, { opacity: 1, x: 0, duration: 0.26, ease: 'power3.out' }, ${s});`)
      break
    case 'char-stagger':
      inLines.push(`  tl.set(${sel}, { opacity: 1 }, ${s});`)
      inLines.push(`  tl.to('.cap${n} .ch', { opacity: 1, y: 0, duration: 0.24, ease: 'power2.out', stagger: { amount: 0.18, from: 'start' } }, ${s});`)
      break
  }
  inLines.push(`  tl.set(${sel}, { opacity: 0 }, ${e});`)

  return { html, tweens: inLines.join('\n') }
}
