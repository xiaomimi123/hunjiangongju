import { describe, it, expect } from 'vitest'
import { buildBodyGraph, type FfBodySegment } from './bodyGraph'

const base = { width: 720, height: 960, fps: 30 }
const seg = (o: Partial<FfBodySegment> = {}): FfBodySegment =>
  ({ imageAbs: '/tmp/a.png', durationMs: 5000, ...o })

describe('buildBodyGraph —— 输入与单段链', () => {
  it('空输入不抛错', () => {
    expect(buildBodyGraph({ ...base, segments: [] })).toEqual(
      { inputArgs: [], filter: '', outLabel: '', totalMs: 0 })
  })

  // 时长按**整数帧**算：5703ms @30fps = 171.09 帧 → 171 帧 = 5.7s。
  // -t 多给一帧的余量，实际长度由滤镜里的 trim=end_frame 决定。
  it('每段一个 -loop 1 静图输入，时长按整数帧给足', () => {
    const g = buildBodyGraph({ ...base, segments: [seg({ imageAbs: '/x/1.png', durationMs: 5703 })] })
    expect(g.inputArgs).toEqual(['-loop', '1', '-framerate', '30', '-t', '5.733', '-i', '/x/1.png'])
    expect(g.filter).toContain('trim=end_frame=171')
    expect(g.totalMs).toBe(5700)
  })

  // ★ 半帧截断会让后一段的 PTS 整体偏离 30fps 网格,拼接后末端的 fps=30 靠复制帧来补,
  // 实测表现为连续 4 帧完全不动然后猛跳 —— 也就是肉眼看到的卡顿。
  it('时长一律落在整帧上，不留半帧', () => {
    const g = buildBodyGraph({ ...base, segments: [
      seg({ durationMs: 5703 }), seg({ durationMs: 8064, transitionIn: null }), seg({ durationMs: 6067, transitionIn: null }),
    ] })
    for (const m of g.filter.matchAll(/trim=end_frame=(\d+)/g)) expect(Number.isInteger(+m[1])).toBe(true)
    // 171 + 242 + 182 = 595 帧 = 19833.333ms
    expect(Math.round(g.totalMs)).toBe(19833)
  })

  // zoompan 是在**输入分辨率**上按整数像素裁剪的，直接在 720×960 上做 1.0→1.1
  // 会因取整误差产生肉眼可见的抖动。必须先预放大。
  // 预放大倍数不是随便取的：实测 2x 逐帧变化 19/40/19/40/42/12 剧烈起伏(台阶抖动),
  // 8x 是 8/8/4/11/5/9 平稳。调小它等于用肉眼可见的抖动换一点内存。
  it('运镜前预放大 8 倍（2 倍会有台阶式抖动）', () => {
    const g = buildBodyGraph({ ...base, segments: [seg({ motion: { scaleFrom: 1, scaleTo: 1.108 } })] })
    expect(g.filter).toContain('scale=5760:7680')
    expect(g.filter).toContain('zoompan=')
  })

  it('运镜末帧恰好落在 scaleTo（不过冲）', () => {
    // 5703ms @30fps = 171 帧 → 分母 170
    const g = buildBodyGraph({ ...base, segments: [seg({ durationMs: 5703, motion: { scaleFrom: 1, scaleTo: 1.108 } })] })
    expect(g.filter).toContain("z='1+(0.108)*on/170'")
  })

  // 线上出过 zoompan 把画面冻住的事故；能不用就不用
  it('静止段不走 zoompan', () => {
    const g = buildBodyGraph({ ...base, segments: [seg({ motion: { scaleFrom: 1, scaleTo: 1 } })] })
    expect(g.filter).not.toContain('zoompan')
    expect(g.filter).toContain('scale=720:960')
  })

  it('静态缩放（首尾相同但不为 1）仍保留创作者的构图', () => {
    const g = buildBodyGraph({ ...base, segments: [seg({ motion: { scaleFrom: 1.189, scaleTo: 1.189 } })] })
    expect(g.filter).not.toContain('zoompan')
    // 5760/1.189≈4844、7680/1.189≈6459，再缩回画布
    expect(g.filter).toContain('crop=4844:6459')
  })
})

describe('buildBodyGraph —— 边界混排', () => {
  it('硬切用 concat，不吃时长', () => {
    const g = buildBodyGraph({ ...base, segments: [
      seg({ durationMs: 4000 }), seg({ durationMs: 3000, transitionIn: null }),
    ] })
    expect(g.filter).toContain('concat=n=2:v=1:a=0')
    expect(g.filter).not.toContain('xfade')
    expect(g.totalMs).toBe(7000)
  })

  // ★ xfade 会让两段重叠播放，**总时长少掉一个转场时长**。
  // 这里算错的话，后面每个边界的时间点都会漂移，且越往后越离谱。
  // ★ 叠化**不吃时长**。原先 xfade 每处让总时长少掉一个转场的长度，
  // 而音频是各段配音直接拼接、字幕用的是未压缩的绝对时间 —— 视频比音频短，
  // 最后 -shortest 把尾巴上的旁白砍掉（线上实测砍掉约 1 秒 = 两处 500ms 叠化，
  // 表现为「文案没读完就结束了」），字幕也会逐段累积落后于画面。
  //
  // 依据：剪映的转场不吃时长 —— 客户样例各段时长之和 24603ms，
  // 草稿声明总时长 24592ms，差 11ms（取整误差）。
  it('叠化不吃总时长：总时长 = 各段之和', () => {
    const g = buildBodyGraph({ ...base, segments: [
      seg({ durationMs: 4000 }), seg({ durationMs: 3000, transitionIn: 'crossfade', transitionMs: 500 }),
    ] })
    // 叠化压在前一段的尾巴上：3.5s→4.0s 混合，第二段的槽位仍从 4.0s 起
    expect(g.filter).toContain('xfade=transition=fade:duration=0.5:offset=3.5')
    expect(g.totalMs).toBe(7000)
  })

  // 叠化要消耗的那几帧必须真渲出来，否则 xfade 会拿不到帧、时长又缩回去
  it('有入场叠化的段多渲转场那几帧', () => {
    const g = buildBodyGraph({ ...base, segments: [
      seg({ durationMs: 4000 }), seg({ durationMs: 3000, transitionIn: 'crossfade', transitionMs: 500 }),
    ] })
    // 3000ms=90 帧，加 500ms=15 帧的引入 → 105
    expect(g.filter).toContain('trim=end_frame=105')
    // 硬切段不多渲
    const hard = buildBodyGraph({ ...base, segments: [
      seg({ durationMs: 4000 }), seg({ durationMs: 3000, transitionIn: null }),
    ] })
    expect(hard.filter).toContain('trim=end_frame=90')
  })

  it('硬切与叠化混排时 offset 逐段累计正确', () => {
    // 客户样例的形态：前几个边界硬切、后面才有叠化
    const g = buildBodyGraph({ ...base, segments: [
      seg({ durationMs: 4000 }),
      seg({ durationMs: 3000, transitionIn: null }),                                   // 累计 7000
      seg({ durationMs: 2000, transitionIn: 'crossfade', transitionMs: 500 }),         // 槽位 7000→9000, offset=6.5
      seg({ durationMs: 2000, transitionIn: 'crossfade', transitionMs: 300 }),         // 槽位 9000→11000, offset=8.7
    ] })
    expect(g.filter).toContain('duration=0.5:offset=6.5')
    expect(g.filter).toContain('duration=0.3:offset=8.7')
    expect(g.totalMs).toBe(11000)
  })

  it('转场窗口不得超过相邻两段中较短者（否则 xfade 吃掉整段）', () => {
    const g = buildBodyGraph({ ...base, segments: [
      seg({ durationMs: 4000 }), seg({ durationMs: 600, transitionIn: 'crossfade', transitionMs: 5000 }),
    ] })
    expect(g.filter).toContain('duration=0.6:')
    expect(g.totalMs).toBe(4600)
  })

  it('末段标签即输出标签', () => {
    const g = buildBodyGraph({ ...base, segments: [seg(), seg({ transitionIn: null }), seg({ transitionIn: null })] })
    expect(g.outLabel).toBe('m2')
    expect(g.filter).toContain('[m2]')
  })
})
