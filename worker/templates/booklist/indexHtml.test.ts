import { describe, it, expect } from 'vitest'
import { renderIndexHtml, type BodyData } from './indexHtml'

const base: BodyData = {
  size: { width: 720, height: 960 },
  overlay: { title: '《活着》', subtitle: '余华 / 著', watermark: '@读书号' },
  images: [{ src: 'media/01.png' }, { src: 'media/02.png' }],
  seed: 'task-seed-1',
  segments: [
    { seqNo: 1, startMs: 0, endMs: 2000, subtitle: '第一句 <字幕>', imageIndex: 0 },
    { seqNo: 2, startMs: 2000, endMs: 4500, subtitle: '第二句', imageIndex: 1 },
  ],
}

// 从产出 HTML 抽出所有 tl.xxx(..., <pos>) 的位置秒数
function tweenPositions(html: string): number[] {
  const out: number[] = []
  const re = /,\s*(\d+(?:\.\d+)?)\)\s*;/g
  let m: RegExpExecArray | null
  const scriptStart = html.indexOf('gsap.timeline')
  const body = html.slice(scriptStart)
  while ((m = re.exec(body))) out.push(parseFloat(m[1]))
  return out
}

describe('renderIndexHtml — 契约', () => {
  const html = renderIndexHtml(base)
  it('声明合成帧与画布尺寸，总时长=最后 endMs', () => {
    expect(html).toContain('data-composition-id="main"')
    expect(html).toContain('data-width="720"')
    expect(html).toContain('data-height="960"')
    expect(html).toContain('data-duration="4.5"')
  })
  it('注册 paused timeline，本地 GSAP，无外网 CDN', () => {
    expect(html).toContain('gsap.timeline({ paused: true })')
    expect(html).toContain('window.__timelines["main"] = tl;')
    expect(html).toContain('<script src="gsap.min.js"></script>')
    expect(html).not.toContain('cdn.jsdelivr.net')
  })
  it('每段一个场景与字幕单元', () => {
    expect(html).toContain('class="scene s1"')
    expect(html).toContain('class="scene s2"')
    expect(html).toContain('class="cap cap1"')
    expect(html).toContain('class="cap cap2"')
  })
  it('转义字幕特殊字符', () => {
    expect(html).toContain('第一句 &lt;字幕&gt;')
    expect(html).not.toContain('第一句 <字幕>')
  })
  it('注入预设 CSS 变量与结构 CSS', () => {
    expect(html).toContain(':root {')
    expect(html).toContain('var(--bg)')
  })
})

describe('renderIndexHtml — seek-safe / 不越界不变量', () => {
  const html = renderIndexHtml(base)
  it('产出不含 function-based 值与 Math.random', () => {
    expect(html).not.toContain('function')
    expect(html).not.toContain('=>')
    expect(html).not.toContain('Math.random')
  })
  it('所有 tween 位置 ∈ [0, data-duration]', () => {
    const dur = 4.5
    for (const p of tweenPositions(html)) {
      expect(p).toBeGreaterThanOrEqual(0)
      expect(p).toBeLessThanOrEqual(dur + 0.001)
    }
  })
})

describe('renderIndexHtml — 确定性与预设', () => {
  it('同输入逐字节一致', () => {
    expect(renderIndexHtml(base)).toBe(renderIndexHtml(base))
  })
  it('style 指定预设时命中对应 token（暗黑高级用 sans 标题字族）', () => {
    const html = renderIndexHtml({ ...base, style: 'dark-premium' })
    expect(html).toContain('--accent: #d4af6a')
  })
})

describe('renderIndexHtml — 首场景开场 + 运镜/转场轮换', () => {
  const html = renderIndexHtml(base)
  it('首场景玻璃碎片开场，t=0 起 stagger 归位', () => {
    expect(html).toContain('class="shatter s1shatter"')
    expect((html.match(/class="shard"/g) ?? []).length).toBeGreaterThanOrEqual(20)
    expect(html).toContain("stagger: { amount: 0.45, from: 'center' } }, 0);")
  })
  it('每段 .photo 都有运镜 tween', () => {
    expect(html).toContain(".s1 .photo'")
    expect(html).toContain(".s2 .photo'")
  })
  it('第二段有进入转场（操作 .s2 与 .s1）', () => {
    // s1→s2 边界在 2 秒，转场类型由分配决定，但必然操作到 .s2
    expect(html).toContain("'.s2'")
  })
})

describe('renderIndexHtml — 向后兼容', () => {
  it('无 seed/style 也能渲染（回退默认预设，不抛）', () => {
    const { seed, ...noSeed } = base
    expect(() => renderIndexHtml(noSeed)).not.toThrow()
  })
  it('无 captionBeats：每段回退整段一条字幕', () => {
    const html = renderIndexHtml(base)
    expect(html).toContain('class="cap cap1"')
    expect(html).toContain('class="cap cap2"')
  })
})

// 书单模式
const booksData: BodyData = {
  size: { width: 720, height: 960 },
  overlay: { title: '', subtitle: '', watermark: '@听页' },
  images: [{ src: 'media/01.png' }, { src: 'media/02.png' }, { src: 'media/03.png' }],
  seed: 'books-seed',
  segments: [
    { seqNo: 1, startMs: 0, endMs: 2000, subtitle: 'a', subtitleEn: 'A', imageIndex: 0, bookTitle: '活下去的理由', bookAuthor: '马特·海格' },
    { seqNo: 2, startMs: 2000, endMs: 4000, subtitle: 'b <x>', subtitleEn: 'B & c', imageIndex: 1, bookTitle: '活下去的理由', bookAuthor: '马特·海格' },
    { seqNo: 3, startMs: 4000, endMs: 6000, subtitle: 'c', subtitleEn: 'C', imageIndex: 2, bookTitle: '当下的力量', bookAuthor: '托利' },
  ],
}

describe('renderIndexHtml — 书单模式', () => {
  const html = renderIndexHtml(booksData)
  it('渲染常驻书名头（含 kicker），连续同书合并', () => {
    expect(html).toContain('class="book-header bh1"')
    expect(html).toContain('bh-kicker')
    expect((html.match(/class="book-header bh1"/g) ?? []).length).toBe(1)
    expect(html).toContain('class="book-header bh2"')
    expect(html).toContain('活下去的理由')
    expect(html).toContain('当下的力量')
  })
  it('渲染中英双语字幕并转义', () => {
    expect(html).toContain('class="cap-en"')
    expect(html).toContain('b &lt;x&gt;')
    expect(html).toContain('B &amp; c')
  })
  it('书单模式不渲染开场标题卡', () => {
    expect(html).not.toContain('class="title-card"')
  })
})

describe('renderIndexHtml — captionBeats 精确节拍', () => {
  it('有节拍时按拍展开为多个 cap 单元，位置取拍的 startMs/endMs', () => {
    const withBeats: BodyData = {
      ...base,
      segments: [
        { seqNo: 1, startMs: 0, endMs: 2000, subtitle: '整段', imageIndex: 0,
          captionBeats: [ { zh: '前拍', startMs: 0, endMs: 1000 }, { zh: '后拍', startMs: 1000, endMs: 2000 } ] },
        { seqNo: 2, startMs: 2000, endMs: 4500, subtitle: '第二段', imageIndex: 1 },
      ],
    }
    const html = renderIndexHtml(withBeats)
    // 段1 两拍 + 段2 一条 = 3 个 cap 单元
    expect(html).toContain('class="cap cap1"')
    expect(html).toContain('class="cap cap2"')
    expect(html).toContain('class="cap cap3"')
    expect(html).toContain('前拍')
    // 注：seed 'task-seed-1' 下第二拍入场型轮换命中 char-stagger（逐字 span 渲染，
    // 见 captionsAnim.ts），"后拍" 会被拆成 <span class="ch">后</span><span class="ch">拍</span>，
    // 因此按字符分别断言而非整词子串。
    expect(html).toContain('>后<')
    expect(html).toContain('>拍<')
  })
})
