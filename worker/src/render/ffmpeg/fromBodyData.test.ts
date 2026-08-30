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

  it('双语参数映射进 assStyle', () => {
    const o = fromBodyData(data({ templateParams: params({
      text: { bilingual: true, enScale: 0.5, enColor: '#cccccc', enGapPx: 12 },
    }) }), io)
    expect(o.assStyle.bilingual).toBe(true)
    expect(o.assStyle.enScale).toBe(0.5)
    expect(o.assStyle.enColor).toBe('#cccccc')
    expect(o.assStyle.enGapPx).toBe(12)
  })

  it('没配双语时 assStyle 里不出现 bilingual（老调用零回归）', () => {
    const o = fromBodyData(data(), io)
    expect('bilingual' in o.assStyle).toBe(false)
  })

  it('captionBeats 的 en 透传进 bodySegments', () => {
    const o = fromBodyData(data({
      segments: [
        { seqNo: 1, startMs: 0, endMs: 3984, subtitle: '今天分享的是', imageIndex: 0 },
        { seqNo: 2, startMs: 3984, endMs: 9687, subtitle: '第一句', imageIndex: 1, bookTitle: '活着', bookAuthor: '余华',
          captionBeats: [{ zh: '中文', en: 'English', startMs: 4200, endMs: 9000 }] },
        { seqNo: 3, startMs: 9687, endMs: 15000, subtitle: '第二句', imageIndex: 2, bookTitle: '活着', bookAuthor: '余华' },
      ],
    }), io)
    expect(o.bodySegments[0].captionBeats![0].en).toBe('English')
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

// ★ 开场标题在 ffmpeg 迁移时整段丢了：这里用 segs.slice(1) 把第 0 段（开场+快闪窗口）
// 扔掉，而「今天分享的是…」正是第 0 段的字幕。成片开头一直没有这行字，
// 单测和各模块自己的 e2e 都看不到——只有拿成片跟原工程逐帧比才发现。
describe('fromBodyData —— 开场标题', () => {
  it('开场标题取自 open.titleText，铺满开场窗口', () => {
    const o = fromBodyData(data(), io)
    expect(o.openTitle).toEqual({ text: '今天分享的是', startMs: 0, endMs: 2159 })
  })

  it('框架没写 titleText 时回退第 0 段的字幕', () => {
    const o = fromBodyData(data({ templateParams: params({ open: { durationMs: 2159, shatter: true, titleText: '' } }) }), io)
    expect(o.openTitle?.text).toBe('今天分享的是')
  })
})

// ★ 字号只标定正文字幕一个锚点，其余按草稿实测的相对倍数派生。
// 之前六个字号各拍一个绝对值，结果常驻大标题只有正文的 1.09 倍，
// 而草稿实测是 1.85 倍 —— 成片里大标题明显偏小。
describe('fromBodyData —— 文字层字号与位置', () => {
  it('各层字号 = 正文字号 × 草稿实测倍数', () => {
    const o = fromBodyData(data({ templateParams: params({
      text: { openTitlePosY: 0.8, openTitleScale: 2, flashTitlePosY: 0.2, flashTitleScale: 3,
        bookTitlePosY: 0.3, bookTitleScale: 4 },
    }) }), io)
    const cap = o.assStyle.captionSizePx
    expect(o.assStyle.openTitleSizePx).toBe(cap * 2)
    expect(o.assStyle.flashTitleSizePx).toBe(cap * 3)
    // 常驻大标题额外乘 TITLE_BOOST(1.3)：客户要求成片里的书名再大一些，
    // 是**有意偏离**草稿实测比例。放在渲染层而不是改 text.bookTitleScale，
    // 因为那个值来自草稿解析，重新导入工程会被覆盖回去。
    expect(o.assStyle.titleSizePx).toBe(Math.round(cap * 4 * 1.3))
  })

  it('各层竖直位置原样带过去（之前是写死在渲染层的）', () => {
    const o = fromBodyData(data({ templateParams: params({
      text: { openTitlePosY: 0.811, openTitleScale: 1.13, flashTitlePosY: 0.169, flashTitleScale: 1.96,
        bookTitlePosY: 0.218, bookTitleScale: 1.85 },
    }) }), io)
    expect(o.assStyle.openTitlePosY).toBe(0.811)
    expect(o.assStyle.flashTitlePosY).toBe(0.169)
    expect(o.assStyle.titlePosY).toBe(0.218)
  })

  // 常驻大标题必须明显大于正文——这是"大标题偏小"那条反馈的守卫
  it('常驻大标题显著大于正文字幕', () => {
    const o = fromBodyData(data(), io)
    expect(o.assStyle.titleSizePx / o.assStyle.captionSizePx).toBeGreaterThan(1.5)
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
  // ★ 开场图有自己的槽位后，必须优先用它。
  // 之前渲染层直接取正片第 1 张，导致「开场卡通头像」和「正片艺术画风」二选一。
  it('配了开场图就用它，不再借正片第 1 张', () => {
    const o = fromBodyData(data({ openImage: { src: 'media/open.png' } }), io)
    expect(o.openStillAbs).toBe('/data/gen/x/hf/media/open.png')
  })

  it('没配开场图才回退正片第 1 张（老框架零回归）', () => {
    expect(fromBodyData(data(), io).openStillAbs).toBe('/data/gen/x/hf/media/01.png')
  })

  it('有开场片段时不再给 openStillAbs（用不上）', () => {
    const o = fromBodyData(data(), { ...io, openingClipAbs: '/o.mp4' })
    expect(o.openingClipAbs).toBe('/o.mp4')
    expect(o.openStillAbs).toBeUndefined()
  })
})
