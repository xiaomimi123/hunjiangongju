import { describe, it, expect } from 'vitest'
import { openTitleHtml, openTitleTweens, flashCardsHtml, flashCardsTweens } from './flashMontage'

const covers = [
  { title: '活着', author: '余华', coverSrc: 'covers/01.png' },
  { title: '兄弟', coverSrc: 'covers/02.png' },
]
const tl = { openEndMs: 2000, flashEndMs: 4000, perClipMs: 1000, count: 2 }

describe('openTitle', () => {
  it('标题元素含文本、data-layout-ignore、转义', () => {
    expect(openTitleHtml('今天<x>')).toContain('class="flash-open" data-layout-ignore')
    expect(openTitleHtml('今天<x>')).toContain('今天&lt;x&gt;')
  })
  it('0s 淡入、openEndMs 前收起', () => {
    const t = openTitleTweens(2000)
    expect(t).toContain(', 0)')
    expect(t).not.toContain('function')
  })
})

describe('flashCards', () => {
  it('每本一卡：封面底图 + 叠书名(标题字体类)', () => {
    const h = flashCardsHtml(covers, 'flash-title')
    expect((h.match(/class="flashcard/g) ?? []).length).toBe(2)
    expect(h).toContain("covers/01.png")
    expect(h).toContain('活着')
    expect(h).toContain('flash-title') // 标题字体族类名
  })
  it('每卡在 openEndMs+k*perClipMs 处切入，位置字面量、不含 function', () => {
    const t = flashCardsTweens(covers, tl, true)
    expect(t).toContain(', 2)')  // 第0本 @ 2.0s
    expect(t).toContain(', 3)')  // 第1本 @ 3.0s
    expect(t).not.toContain('function')
    expect(t).not.toContain('=>')
  })
  it('coverScale 缺省 → .fc-cover 不带 transform', () => {
    const h = flashCardsHtml(covers, 'flash-title')
    expect(h).not.toContain('transform')
  })
  it('coverScale 恰为 1 → .fc-cover 不带 transform（与缺省逐字节一致）', () => {
    const withScale1 = flashCardsHtml(covers, 'flash-title', 1)
    const withoutScale = flashCardsHtml(covers, 'flash-title')
    expect(withScale1).toBe(withoutScale)
    expect(withScale1).not.toContain('transform')
  })
  it('coverScale 有效且≠1 → .fc-cover 带静态 transform:scale(x)', () => {
    const h = flashCardsHtml(covers, 'flash-title', 1.1232)
    expect(h).toContain('transform:scale(1.1232)')
    expect(h).not.toContain('function')
    expect(h).not.toContain('=>')
  })
  it('coverScale < 1 → 不输出 transform（缩小会露出 overflow:hidden 卡片下的场景，M-3）', () => {
    const h = flashCardsHtml(covers, 'flash-title', 0.9)
    expect(h).not.toContain('transform')
  })
})

// 阶段1 发现B：原剪映工程的快闪段之间没有任何转场素材，是硬切；而我们给每张卡加了 0.12s 淡入
// （bounceIn 时还叠 scale 弹入）。一张快闪卡只有 150-250ms，0.12s 淡入占掉超过一半生命，
// 原片干脆利落、我们每张都糊一下——这是快闪节奏感丢失的直接原因。
describe('flashCardsTweens —— 硬切模式', () => {
  const covers = [
    { title: '活着', coverSrc: 'c1.png' },
    { title: '兄弟', coverSrc: 'c2.png' },
  ]
  const t = { openEndMs: 2000, perClipMs: 200, flashEndMs: 2400 }

  it('hardCut=true → 用 tl.set 瞬时切换，不产生任何 fromTo 淡入', () => {
    const out = flashCardsTweens(covers, t, true, true)
    expect(out).not.toContain('fromTo')
    expect(out).not.toContain('duration: 0.12')
    // 每张卡两条：出现(set opacity 1) 与 消失(set opacity 0)
    expect(out).toContain(`tl.set('.fc1', { opacity: 1 }, 2)`)
    expect(out).toContain(`tl.set('.fc1', { opacity: 0 }, 2.2)`)
    expect(out).toContain(`tl.set('.fc2', { opacity: 1 }, 2.2)`)
    expect(out).toContain(`tl.set('.fc2', { opacity: 0 }, 2.4)`)
  })

  it('硬切模式下 bounceIn 不再产生 scale 弹入（硬切与弹入互斥）', () => {
    expect(flashCardsTweens(covers, t, true, true)).not.toContain('scale')
  })

  it('回归红线：hardCut 缺省时输出与改动前逐字节相同', () => {
    const EXPECTED_BOUNCE = [
      `  tl.fromTo('.fc1', { opacity: 0, scale: 0.86 }, { opacity: 1, scale: 1, duration: 0.12, ease: 'back.out(2)' }, 2);`,
      `  tl.set('.fc1', { opacity: 0 }, 2.2);`,
      `  tl.fromTo('.fc2', { opacity: 0, scale: 0.86 }, { opacity: 1, scale: 1, duration: 0.12, ease: 'back.out(2)' }, 2.2);`,
      `  tl.set('.fc2', { opacity: 0 }, 2.4);`,
    ].join('\n')
    expect(flashCardsTweens(covers, t, true)).toBe(EXPECTED_BOUNCE)

    const EXPECTED_PLAIN = [
      `  tl.fromTo('.fc1', { opacity: 0 }, { opacity: 1, duration: 0.12, ease: 'back.out(2)' }, 2);`,
      `  tl.set('.fc1', { opacity: 0 }, 2.2);`,
      `  tl.fromTo('.fc2', { opacity: 0 }, { opacity: 1, duration: 0.12, ease: 'back.out(2)' }, 2.2);`,
      `  tl.set('.fc2', { opacity: 0 }, 2.4);`,
    ].join('\n')
    expect(flashCardsTweens(covers, t, false)).toBe(EXPECTED_PLAIN)
  })
})
