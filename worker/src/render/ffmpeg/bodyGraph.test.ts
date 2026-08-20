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

  it('每段一个 -loop 1 静图输入，时长写在 -t 上', () => {
    const g = buildBodyGraph({ ...base, segments: [seg({ imageAbs: '/x/1.png', durationMs: 5703 })] })
    expect(g.inputArgs).toEqual(['-loop', '1', '-framerate', '30', '-t', '5.703', '-i', '/x/1.png'])
  })

  // zoompan 是在**输入分辨率**上按整数像素裁剪的，直接在 720×960 上做 1.0→1.1
  // 会因取整误差产生肉眼可见的抖动。必须先预放大。
  it('运镜前先预放大（否则 zoompan 逐帧取整会抖）', () => {
    const g = buildBodyGraph({ ...base, segments: [seg({ motion: { scaleFrom: 1, scaleTo: 1.108 } })] })
    expect(g.filter).toContain('scale=1440:1920')
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
    // 1440/1.189≈1211、1920/1.189≈1615，再缩回画布
    expect(g.filter).toContain('crop=1211:1615')
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
  it('叠化用 xfade，总时长扣掉转场窗口', () => {
    const g = buildBodyGraph({ ...base, segments: [
      seg({ durationMs: 4000 }), seg({ durationMs: 3000, transitionIn: 'crossfade', transitionMs: 500 }),
    ] })
    expect(g.filter).toContain('xfade=transition=fade:duration=0.5:offset=3.5')
    expect(g.totalMs).toBe(6500)
  })

  it('硬切与叠化混排时 offset 逐段累计正确', () => {
    // 客户样例的形态：前几个边界硬切、后面才有叠化
    const g = buildBodyGraph({ ...base, segments: [
      seg({ durationMs: 4000 }),
      seg({ durationMs: 3000, transitionIn: null }),                                   // 累计 7000
      seg({ durationMs: 2000, transitionIn: 'crossfade', transitionMs: 500 }),         // offset=6.5, 累计 8500
      seg({ durationMs: 2000, transitionIn: 'crossfade', transitionMs: 300 }),         // offset=8.2, 累计 10200
    ] })
    expect(g.filter).toContain('duration=0.5:offset=6.5')
    expect(g.filter).toContain('duration=0.3:offset=8.2')
    expect(g.totalMs).toBe(10200)
  })

  it('转场窗口不得超过相邻两段中较短者（否则 xfade 吃掉整段）', () => {
    const g = buildBodyGraph({ ...base, segments: [
      seg({ durationMs: 4000 }), seg({ durationMs: 600, transitionIn: 'crossfade', transitionMs: 5000 }),
    ] })
    expect(g.filter).toContain('duration=0.6:')
    expect(g.totalMs).toBe(4000)
  })

  it('末段标签即输出标签', () => {
    const g = buildBodyGraph({ ...base, segments: [seg(), seg({ transitionIn: null }), seg({ transitionIn: null })] })
    expect(g.outLabel).toBe('m2')
    expect(g.filter).toContain('[m2]')
  })
})
