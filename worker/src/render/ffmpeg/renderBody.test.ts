import { describe, it, expect } from 'vitest'
import { buildRenderBodyPlan, bookTitleRuns, captionCues, type RenderBodyOpts, type RenderBodySegment } from './renderBody'

const seg = (o: Partial<RenderBodySegment> & { startMs: number; endMs: number }): RenderBodySegment =>
  ({ imageAbs: '/img/a.png', ...o })

const baseOpts = (segments: RenderBodySegment[], extra: Partial<RenderBodyOpts> = {}): RenderBodyOpts => ({
  segments, width: 720, height: 960, fps: 30, timeOffsetMs: 0,
  assStyle: { fontName: 'F', captionColor: '#fff', captionPosY: 0.78, captionSizePx: 44, titleSizePx: 56, titleColor: '#fff', watermarkSizePx: 22 },
  decor: { scrimHeightPx: 340, scrimAlpha: 0.85, vignette: true, grain: false },
  assAbs: '/tmp/s.ass', outAbs: '/tmp/o.mp4',
  ...extra,
})

// 与 indexHtml.ts 的 bookRuns 是同一套语义。两个渲染器对「书名什么时候换」
// 理解不同，会让灰度切换时画面出现看不出原因的差异。
describe('bookTitleRuns', () => {
  it('连续同书名合并成一段', () => {
    expect(bookTitleRuns([
      seg({ startMs: 0, endMs: 1000, bookTitle: '简爱' }),
      seg({ startMs: 1000, endMs: 2000, bookTitle: '简爱' }),
      seg({ startMs: 2000, endMs: 3000, bookTitle: '活着' }),
    ])).toEqual([
      { text: '《简爱》', startMs: 0, endMs: 2000 },
      { text: '《活着》', startMs: 2000, endMs: 3000 },
    ])
  })
  // ★ 这里必须是**真换行符**。写成 ASS 的 \N 会被 escapeAssText 再转义一次,
  // 成片上多出一个可见的反斜杠 —— 单测全绿,目视成片才发现。
  it('带作者时用真换行符，交给 escapeAssText 转成 ASS 换行', () => {
    const t = bookTitleRuns([seg({ startMs: 0, endMs: 1000, bookTitle: '简爱', bookAuthor: '夏洛蒂·勃朗特' })])[0].text
    expect(t).toBe('《简爱》\n夏洛蒂·勃朗特')
    expect(t).not.toContain('\\N')
  })
  it('无书名的段被跳过，不产出空标题', () => {
    expect(bookTitleRuns([seg({ startMs: 0, endMs: 1000 }), seg({ startMs: 1000, endMs: 2000, bookTitle: '  ' })])).toEqual([])
  })
})

describe('captionCues', () => {
  it('优先用 captionBeats（一段图上可以换多次字幕）', () => {
    const c = captionCues([seg({ startMs: 0, endMs: 5000, subtitle: '整段', captionBeats: [
      { zh: '前半句', startMs: 0, endMs: 2000 }, { zh: '后半句', startMs: 2000, endMs: 5000 },
    ] })])
    expect(c.map((x) => x.text)).toEqual(['前半句', '后半句'])
  })
  it('没有 captionBeats 时退化成整段一条', () => {
    expect(captionCues([seg({ startMs: 0, endMs: 5000, subtitle: '整段' })]))
      .toEqual([{ text: '整段', startMs: 0, endMs: 5000 }])
  })
  it('空文本被丢弃', () => {
    expect(captionCues([seg({ startMs: 0, endMs: 1000 })])).toEqual([])
  })
})

describe('buildRenderBodyPlan', () => {
  const segs = [
    seg({ startMs: 4000, endMs: 9000, bookTitle: '简爱', captionBeats: [{ zh: '第一句', startMs: 4000, endMs: 6500 }] }),
    seg({ imageAbs: '/img/b.png', startMs: 9000, endMs: 14000, bookTitle: '简爱' }),
    seg({ imageAbs: '/img/c.png', startMs: 14000, endMs: 19000, bookTitle: '简爱' }),
  ]

  // ★ 字幕时间是全片绝对值；单渲正片片段时必须整体左移，否则字幕全部晚 4 秒
  it('timeOffsetMs 把字幕时间左移到片段本地坐标', () => {
    const p = buildRenderBodyPlan(baseOpts(segs, { timeOffsetMs: 4000 }))
    expect(p.assContent).toContain('0:00:00.00,0:00:02.50,cap')   // 4000→0, 6500→2500
    expect(p.assContent).not.toContain('0:00:04.00,0:00:06.50')
  })

  it('offset 为 0 时字幕保持绝对时间', () => {
    const p = buildRenderBodyPlan(baseOpts(segs, { timeOffsetMs: 0 }))
    expect(p.assContent).toContain('0:00:04.00,0:00:06.50,cap')
  })

  // 没有实测转场序列时一律硬切，不凭空造叠化——草稿里没有的东西不该出现在成片里
  it('bodyCycle 为空 → 全硬切', () => {
    const p = buildRenderBodyPlan(baseOpts(segs))
    expect(p.args.join(' ')).toContain('concat=n=2:v=1:a=0')
    expect(p.args.join(' ')).not.toContain('xfade')
    expect(p.totalMs).toBe(15000)
  })

  // 叠化**不扣时长**（见 bodyGraph 的 leadFrames）：原先每处 xfade 让总时长少掉一个
  // 转场的长度，而音频与字幕都在未压缩的时间轴上，结果尾巴上的旁白被 -shortest 砍掉。
  it('bodyCycle 非空 → 按序循环套用，总时长仍是各段之和', () => {
    const p = buildRenderBodyPlan(baseOpts(segs, {
      bodyCycle: [{ renderType: 'crossfade', durationMs: 500 }],
    }))
    expect(p.args.join(' ')).toContain('xfade=transition=fade:duration=0.5')
    expect(p.totalMs).toBe(15000)
  })

  // ★ 逐边界硬切：渲染层只实现了叠化，所以「这条边界要硬切」只能靠时长表达。
  // 不能指望 durationMs=0 走叠化分支后自然消失——bodyGraph 会把它夹到 1ms
  //（`Math.max(1, ...)`），产出一次看不见却照样走 xfade 的转场，与硬切不是一回事：
  // xfade 会改变滤镜图结构与帧的来源，而硬切是 concat。
  it('转场时长为 0 → 该边界硬切（走 concat 而非 xfade）', () => {
    const p = buildRenderBodyPlan(baseOpts(segs, {
      bodyCycle: [{ renderType: 'crossfade', durationMs: 0 }],
    }))
    expect(p.args.join(' '), '时长 0 仍走了 xfade').not.toContain('xfade')
    expect(p.args.join(' ')).toContain('concat=')
    expect(p.totalMs).toBe(15000)
  })

  it('叠化与硬切可以逐边界混用（循环套用）', () => {
    const three = [
      { imageAbs: '/a.png', startMs: 0, endMs: 5000, captionBeats: [] },
      { imageAbs: '/b.png', startMs: 5000, endMs: 10000, captionBeats: [] },
      { imageAbs: '/c.png', startMs: 10000, endMs: 15000, captionBeats: [] },
    ]
    const p = buildRenderBodyPlan(baseOpts(three, {
      // 第 1 条边界硬切、第 2 条叠化 500ms
      bodyCycle: [{ renderType: 'crossfade', durationMs: 0 }, { renderType: 'crossfade', durationMs: 500 }],
    }))
    const f = p.args.join(' ')
    expect(f, '混用时叠化那条没生效').toContain('xfade=transition=fade:duration=0.5')
    // 只该有一处 xfade：两条边界里只有一条是叠化
    expect(f.match(/xfade/g)?.length, '硬切那条也变成了叠化').toBe(1)
  })

  it('运镜按序循环套用到各段', () => {
    const p = buildRenderBodyPlan(baseOpts(segs, {
      keyframes: [{ scaleFrom: 1, scaleTo: 1.108 }, { scaleFrom: 1, scaleTo: 1.082 }],
    }))
    const f = p.args.join(' ')
    expect(f).toContain('0.108')
    expect(f).toContain('0.082')
    // 第三段循环回第一条
    expect((f.match(/0\.108/g) ?? []).length).toBe(2)
  })

  it('每段一个图片输入，装饰层输入排在它们之后', () => {
    const p = buildRenderBodyPlan(baseOpts(segs))
    const i = p.args.indexOf('-filter_complex')
    const inputs = p.args.slice(0, i).filter((x) => x === '-i')
    expect(inputs.length).toBe(4)  // 3 张图 + 1 个压暗底 lavfi
    expect(p.args.join(' ')).toContain('[3:v]overlay')  // 压暗底下标 = 图片数
  })

  // 字幕必须最后烧：压暗底压在字幕下面、暗角不压字幕
  it('字幕烧在装饰层之后', () => {
    const f = p_filter(buildRenderBodyPlan(baseOpts(segs)))
    expect(f.indexOf('overlay=x=0')).toBeLessThan(f.indexOf('subtitles='))
    expect(f).toMatch(/\[dec\]subtitles=.*\[vout\]$/)
  })

  it('产出的 ASS 里书名头是 ASS 换行，且不带多余反斜杠', () => {
    const a = buildRenderBodyPlan(baseOpts([
      seg({ startMs: 0, endMs: 5000, bookTitle: '简爱', bookAuthor: '夏洛蒂·勃朗特' }),
    ])).assContent
    // 书名与作者各带自己的 \fs（见 ass.ts「常驻大标题的字号」），中间仍是 ASS 换行 \N
    expect(a).toMatch(/《简爱》\\N\{\\fs\d+\}夏洛蒂·勃朗特/)
    expect(a).not.toContain('《简爱》\\\\N')          // 但不能是被转义过的 \\N
  })

  it('正片段不含音频（音频在最后一步与开场段一起混）', () => {
    expect(buildRenderBodyPlan(baseOpts(segs)).args).toContain('-an')
  })

  it('无水印时 ASS 不产出水印事件', () => {
    expect(buildRenderBodyPlan(baseOpts(segs)).assContent).not.toContain(',wm,,')
    expect(buildRenderBodyPlan(baseOpts(segs, { watermark: '@号' })).assContent).toContain(',wm,,')
  })
})

function p_filter(p: { args: string[] }): string {
  return p.args[p.args.indexOf('-filter_complex') + 1]
}
