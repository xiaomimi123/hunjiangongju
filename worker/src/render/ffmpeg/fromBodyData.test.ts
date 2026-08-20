import { describe, it, expect } from 'vitest'
import { fromBodyData } from './fromBodyData'
import { parseTemplateParams } from '../../../templates/booklist/templateParams'
import type { BodyData } from '../../../templates/booklist/bodyData'

const params = (extra: Record<string, unknown> = {}) =>
  parseTemplateParams({ mode: 'flash', open: { durationMs: 2159, shatter: true }, ...extra })

const data = (extra: Partial<BodyData> = {}): BodyData => ({
  size: { width: 720, height: 960 },
  overlay: { title: '', subtitle: '', watermark: '@读书号' },
  images: [{ src: 'media/01.png' }, { src: 'media/02.png' }, { src: 'media/03.png' }],
  seed: 's', template: 'flash', templateParams: params(),
  flashCovers: [
    { title: '活着', author: '余华', coverSrc: 'covers/01.png' },
    { title: '兄弟', coverSrc: 'covers/02.png' },
  ],
  segments: [
    { seqNo: 1, startMs: 0, endMs: 3984, subtitle: '今天分享的是', imageIndex: 0 },
    { seqNo: 2, startMs: 3984, endMs: 9687, subtitle: '第一句', imageIndex: 1, bookTitle: '活着', bookAuthor: '余华',
      captionBeats: [{ zh: '第一句', startMs: 4200, endMs: 9000 }] },
    { seqNo: 3, startMs: 9687, endMs: 15000, subtitle: '第二句', imageIndex: 2, bookTitle: '活着', bookAuthor: '余华' },
  ],
  ...extra,
})

const io = { hfDir: '/data/gen/x/hf', assAbs: '/data/gen/x/s.ass', outAbs: '/data/gen/x/hf/renders/body.mp4' }

describe('fromBodyData —— 新旧渲染器的唯一接缝', () => {
  // 第 0 段是「开场 + 快闪」的时间窗，第 1..N 段才是正片。
  // 这套划分必须与 HyperFrames 分支一致，否则灰度切换时段落会错位。
  it('第 0 段不进正片，正片从第 1 段开始', () => {
    const o = fromBodyData(data(), io)
    expect(o.bodySegments).toHaveLength(2)
    expect(o.bodySegments[0].startMs).toBe(3984)
    expect(o.bodySegments[0].imageAbs).toBe('/data/gen/x/hf/media/02.png')
  })

  it('相对路径按 hfDir 展开成绝对路径', () => {
    const o = fromBodyData(data(), io)
    expect(o.flashCards[0].coverAbs).toBe('/data/gen/x/hf/covers/01.png')
  })

  // 快闪卡排在 openEnd→flashEnd 窗口内；openEnd 由 flashTimeline 算
  // （min(open.durationMs, seg0End*0.55)），不是直接用 open.durationMs
  it('快闪卡落在开场结束→快闪结束的窗口内，首尾相接', () => {
    const o = fromBodyData(data(), io)
    expect(o.flashCards).toHaveLength(2)
    expect(o.flashCards[0].startMs).toBe(2159)          // min(2159, 3984*0.55=2191)
    expect(o.flashCards[1].endMs).toBe(3984)            // 铺满到快闪结束
    expect(o.flashCards[1].startMs).toBe(o.flashCards[0].endMs)
  })

  it('无书封时不产出快闪段', () => {
    expect(fromBodyData(data({ flashCovers: [] }), io).flashCards).toEqual([])
  })

  it('字幕拍点与书名作者原样带过去', () => {
    const o = fromBodyData(data(), io)
    expect(o.bodySegments[0].captionBeats).toEqual([{ zh: '第一句', startMs: 4200, endMs: 9000 }])
    expect(o.bodySegments[0].bookTitle).toBe('活着')
    expect(o.bodySegments[0].bookAuthor).toBe('余华')
  })

  it('运镜与逐边界转场从 templateParams 带过去', () => {
    const o = fromBodyData(data({ templateParams: params({
      motion: { moves: [], keyframes: [{ scaleFrom: 1, scaleTo: 1.108 }] },
      transition: { type: 'dissolve', durationMs: 400, bodyCycle: [{ renderType: 'crossfade', durationMs: 500 }] },
    }) }), io)
    expect(o.keyframes).toEqual([{ scaleFrom: 1, scaleTo: 1.108 }])
    expect(o.bodyCycle).toEqual([{ renderType: 'crossfade', durationMs: 500 }])
  })

  // 水波纹位置是**相对快闪结束那一刀**的偏移，不是绝对时间
  it('水波纹按 flashEnd + offset 定位；缺素材或缺参数则不叠', () => {
    const withRipple = fromBodyData(
      data({ templateParams: params({ effects: { ripple: { offsetMs: 7, durationMs: 458 } } }) }),
      { ...io, ripple: { xmapAbs: '/x/%03d.png', ymapAbs: '/y/%03d.png' } },
    )
    expect(withRipple.ripple).toEqual({
      xmapAbs: '/x/%03d.png', ymapAbs: '/y/%03d.png', atMs: 3984 + 7, durationMs: 458,
    })
    // 框架没提取到 ripple 参数 → 不叠
    expect(fromBodyData(data(), { ...io, ripple: { xmapAbs: '/x', ymapAbs: '/y' } }).ripple).toBeUndefined()
    // 有参数但没预渲染素材 → 也不叠
    expect(fromBodyData(data({ templateParams: params({ effects: { ripple: { offsetMs: 7, durationMs: 458 } } }) }), io).ripple)
      .toBeUndefined()
  })

  it('颗粒只有 ink-oriental 预设才开', () => {
    expect(fromBodyData(data(), io).decor.grain).toBe(false)
    expect(fromBodyData(data({ style: 'ink-oriental' }), io).decor.grain).toBe(true)
  })

  it('字幕颜色与竖直位置取自 templateParams', () => {
    const o = fromBodyData(data({ templateParams: params({ body: { subtitleColor: '#ffcc00', subtitlePosY: 0.7 } }) }), io)
    expect(o.assStyle.captionColor).toBe('#ffcc00')
    expect(o.assStyle.captionPosY).toBe(0.7)
  })

  it('自带字体：fontsDir 与 fontName 都指向仓库内的字体', () => {
    const o = fromBodyData(data(), io)
    expect(o.assStyle.fontName).toBe('Noto Sans SC')
    expect(o.fontsDir).toContain('templates/booklist/fonts')
  })

  it('开场片段缺省时不产出 openingClipAbs（整片从快闪开始）', () => {
    expect(fromBodyData(data(), io).openingClipAbs).toBeUndefined()
    expect(fromBodyData(data(), { ...io, openingClipAbs: '/o.mp4' }).openingClipAbs).toBe('/o.mp4')
  })
})

// ★ 没有开场碎裂片段时必须给 openStillAbs 补住开场那一段。
// 留空会让成片比音频短掉整个开场时长(实测 2.13 秒),音画从头就错位 ——
// 这个 bug 是接线层的真渲验收抓出来的,单测和各模块自己的 e2e 都看不到。
describe('fromBodyData —— 开场那一段不能留空', () => {
  it('无开场片段时给出 openStillAbs（首图）', () => {
    const o = fromBodyData(data(), io)
    expect(o.openingClipAbs).toBeUndefined()
    expect(o.openStillAbs).toBe('/data/gen/x/hf/media/01.png')
  })
  it('有开场片段时不再给 openStillAbs（用不上）', () => {
    const o = fromBodyData(data(), { ...io, openingClipAbs: '/o.mp4' })
    expect(o.openingClipAbs).toBe('/o.mp4')
    expect(o.openStillAbs).toBeUndefined()
  })
})
