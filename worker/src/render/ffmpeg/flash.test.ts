import { describe, it, expect } from 'vitest'
import { distributeCards, buildFlashAss, buildFlashPlan, type FlashOpts, type FlashCard } from './flash'

// 客户样例实测：开场结束 2159ms → 快闪结束 3984ms，窗口 1825ms，9 张卡
const CLIP_MS = [150, 251, 195, 191, 204, 197, 189, 222, 221]

describe('distributeCards', () => {
  it('无权重时等分', () => {
    expect(distributeCards(4, 1000)).toEqual([
      { startMs: 0, endMs: 250 }, { startMs: 250, endMs: 500 },
      { startMs: 500, endMs: 750 }, { startMs: 750, endMs: 1000 },
    ])
  })

  // ★ 等分会把原片的律动抹平。原工程各卡 150~251ms 长短相间,那就是「卡点」的本质。
  it('按草稿比例排布，长短相间而非等分', () => {
    const out = distributeCards(9, 1825, CLIP_MS)
    const durs = out.map((x) => x.endMs - x.startMs)
    expect(durs.length).toBe(9)
    // 第 2 张(251ms 权重)应明显长于第 1 张(150ms)
    expect(durs[1]).toBeGreaterThan(durs[0] + 60)
    // 全部加起来正好铺满窗口
    expect(out[out.length - 1].endMs).toBe(1825)
    expect(out[0].startMs).toBe(0)
  })

  it('相邻卡首尾相接，中间不留缝', () => {
    const out = distributeCards(9, 1825, CLIP_MS)
    for (let i = 1; i < out.length; i++) expect(out[i].startMs).toBe(out[i - 1].endMs)
  })

  it('卡数多于草稿条目时循环复用比例', () => {
    const out = distributeCards(12, 2000, [100, 300])
    const durs = out.map((x) => x.endMs - x.startMs)
    // 交替长短
    expect(durs[1]).toBeGreaterThan(durs[0])
    expect(durs[3]).toBeGreaterThan(durs[2])
    expect(out.length).toBe(12)
  })

  it('脏权重被剔除；全脏则退化等分', () => {
    expect(distributeCards(2, 1000, [NaN, -5, 0])).toEqual([
      { startMs: 0, endMs: 500 }, { startMs: 500, endMs: 1000 },
    ])
  })

  it('非法入参返回空数组', () => {
    expect(distributeCards(0, 1000)).toEqual([])
    expect(distributeCards(3, 0)).toEqual([])
  })
})

const card = (i: number, o: Partial<FlashCard> = {}): FlashCard => ({
  coverAbs: `/c/${i}.png`, title: `书${i}`, startMs: 2159 + i * 200, endMs: 2159 + (i + 1) * 200, ...o,
})
const opts = (cards: FlashCard[], extra: Partial<FlashOpts> = {}): FlashOpts => ({
  cards, width: 720, height: 960, fps: 30, timeOffsetMs: 2159, bounceIn: true,
  assStyle: { fontName: 'F', titleSizePx: 60, titleColor: '#ffffff', authorSizePx: 28, authorColor: '#ffcc88' },
  assAbs: '/tmp/f.ass', outAbs: '/tmp/f.mp4', ...extra,
})

describe('buildFlashAss', () => {
  it('书名居中大字、作者在其下方，各自用 \\pos 精确定位', () => {
    const a = buildFlashAss(opts([card(0, { author: '余华' })]), 600)
    expect(a).toContain('{\\pos(360,480)}《书0》')     // 50% 高度
    expect(a).toContain('{\\pos(360,595)}余华')        // 62% 高度
  })

  it('timeOffsetMs 把绝对时间左移到片段本地坐标', () => {
    const a = buildFlashAss(opts([card(0)]), 600)
    expect(a).toContain('0:00:00.00,0:00:00.20')      // 2159→0, 2359→200ms
  })

  it('无作者时不产出作者行', () => {
    const a = buildFlashAss(opts([card(0)]), 600)
    expect(a).not.toContain(',fa,')
  })

  it('超出片段总时长的部分被裁到片尾', () => {
    const a = buildFlashAss(opts([card(0, { endMs: 9999 })]), 400)
    expect(a).toContain('0:00:00.00,0:00:00.40')
  })

  it('PlayRes 与视频尺寸一致（否则字号整体缩水且不报错）', () => {
    const a = buildFlashAss(opts([card(0)]), 600)
    expect(a).toContain('PlayResX: 720')
    expect(a).toContain('PlayResY: 960')
  })
})

describe('buildFlashPlan', () => {
  const cards = [card(0), card(1), card(2)]

  it('全部硬切（草稿里快闪段边界没挂任何转场素材）', () => {
    const p = buildFlashPlan(opts(cards))
    const f = p.args.join(' ')
    expect(f).toContain('concat=n=2:v=1:a=0')
    expect(f).not.toContain('xfade')
    expect(p.totalMs).toBe(600)
  })

  // 弹入是近似：zoompan 缩放下界是 1，做不到「由小变大」，只能「由大收小」
  it('bounceIn 用 1.12→1 的收缩近似原模板的 0.86→1 弹入', () => {
    expect(buildFlashPlan(opts(cards)).args.join(' ')).toContain("z='1.12+(-0.12)*on")
  })

  it('关掉 bounceIn 则各卡静止，不走 zoompan', () => {
    expect(buildFlashPlan(opts(cards, { bounceIn: false })).args.join(' ')).not.toContain('zoompan')
  })

  it('每张卡一个输入，字幕烧在最后', () => {
    const p = buildFlashPlan(opts(cards))
    expect(p.args.filter((x) => x === '-i').length).toBe(3)
    expect(p.args.join(' ')).toMatch(/subtitles=.*\[vout\]/)
  })

  it('快闪段不含音频（音频最后统一混）', () => {
    expect(buildFlashPlan(opts(cards)).args).toContain('-an')
  })
})
