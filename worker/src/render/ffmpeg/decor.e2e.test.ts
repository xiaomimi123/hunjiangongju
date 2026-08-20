// 装饰层的真渲验收：断言**像素上真的变暗了/压边了**。
//
// 这几层全是「肉眼可感、日志无声」的效果——滤镜写错了不会报错，只会画面不对。
// 所以每条断言都配一个反证：关掉该层时同一处测量必须回到基线。

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { spawnSync } from 'child_process'
import { mkdtempSync, rmSync } from 'fs'
import os from 'os'
import path from 'path'
import { buildDecorChain, gradeChain, type DecorOpts } from './decor'

const FFMPEG = process.env.FFMPEG_BIN ?? 'ffmpeg'
const d = process.env.RENDER_E2E === '1' ? describe : describe.skip
const W = 720
const H = 960

/** 某区域的平均亮度 0..255 */
function meanLuma(mp4: string, crop: string, atSec = 1): number {
  const r = spawnSync(FFMPEG,
    ['-v', 'error', '-ss', String(atSec), '-i', mp4, '-frames:v', '1',
      '-vf', `crop=${crop},format=gray`, '-f', 'rawvideo', '-'],
    { encoding: 'buffer', maxBuffer: 64 * 1024 * 1024 })
  const buf = r.stdout as unknown as Buffer
  if (!buf || buf.length === 0) throw new Error('取区域像素失败')
  let sum = 0
  for (const v of buf) sum += v
  return sum / buf.length
}

d('真渲验收 —— 装饰层与调色', () => {
  let dir = ''

  /** 渲一段并套上给定装饰配置。src 缺省是中灰底（便于测「压暗了多少」） */
  function render(name: string, o: DecorOpts, src = `color=c=0x808080:s=${W}x${H}:r=30:d=2`): string {
    const out = path.join(dir, `${name}.mp4`)
    const { inputArgs, chain } = buildDecorChain('0:v', 'out', o, o.scrimHeightPx > 0 ? 1 : undefined)
    const r = spawnSync(FFMPEG, ['-y',
      '-f', 'lavfi', '-i', src,
      ...inputArgs,
      '-filter_complex', chain, '-map', '[out]',
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-pix_fmt', 'yuv420p',
      '-frames:v', '45', out], { encoding: 'utf8' })
    if (r.status !== 0) throw new Error(`渲染失败(${name}): ${(r.stderr ?? '').slice(-700)}`)
    return out
  }

  const plain: DecorOpts = { width: W, height: H, scrimHeightPx: 0, scrimAlpha: 0, vignette: false, grain: false }

  beforeAll(() => { dir = mkdtempSync(path.join(os.tmpdir(), 'mixcut-decor-')) })
  afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }) })

  it('全部关闭时画面不被改动（基线）', () => {
    const base = meanLuma(render('plain', plain), `${W}:100:0:${H - 100}`)
    // 0x808080 在 yuv420p limited range 下解回来约 128
    expect(Math.abs(base - 128)).toBeLessThan(6)
  })

  // ★ 压暗底：底部应明显变暗，而顶部不受影响
  it('压暗底只压底部，顶部不受影响', () => {
    const withScrim = render('scrim', { ...plain, scrimHeightPx: 340, scrimAlpha: 0.85 })
    const bottom = meanLuma(withScrim, `${W}:100:0:${H - 100}`)
    const top = meanLuma(withScrim, `${W}:100:0:0`)
    const baseBottom = meanLuma(render('plain', plain), `${W}:100:0:${H - 100}`)
    expect(bottom, `底部没被压暗: ${bottom} vs 基线 ${baseBottom}`).toBeLessThan(baseBottom - 40)
    // 反证：压暗底范围之外必须还是基线，否则说明整帧被压了
    expect(Math.abs(top - 128)).toBeLessThan(6)
  })

  it('压暗底是渐变而非硬边（中段介于顶部与底部之间）', () => {
    const f = render('scrim2', { ...plain, scrimHeightPx: 340, scrimAlpha: 0.85 })
    const mid = meanLuma(f, `${W}:60:0:${H - 200}`)
    const bottom = meanLuma(f, `${W}:60:0:${H - 60}`)
    expect(mid).toBeGreaterThan(bottom + 10)   // 越往下越暗
    expect(mid).toBeLessThan(128 - 5)          // 但已经开始压了
  })

  // ★ 暗角：四角比中心暗
  it('暗角压边不压中心', () => {
    const f = render('vig', { ...plain, vignette: true })
    const center = meanLuma(f, `200:200:${(W - 200) / 2}:${(H - 200) / 2}`)
    const corner = meanLuma(f, `160:160:0:0`)
    expect(corner, `四角没被压暗: 角=${corner} 心=${center}`).toBeLessThan(center - 20)
  })

  it('关掉暗角后四角回到基线（反证上一条测的是暗角）', () => {
    const f = render('novig', plain)
    expect(Math.abs(meanLuma(f, `160:160:0:0`) - 128)).toBeLessThan(6)
  })

  // ★ 调色。
  // **必须用有内容的画面测**：链的顺序是「调色 → 颗粒 → 暗角」，调色排在颗粒之前，
  // 所以在纯中灰底上加对比度什么也放大不了（第一版就是这么写错的，实测反而更低）。
  // 顺序本身是对的——先定调再加颗粒，否则颗粒会被调色一起拉爆。
  it('调色的对比度提升让画面明暗分布拉开', () => {
    const SRC = `testsrc=size=${W}x${H}:rate=30:duration=2`
    const withGrade = render('grade', { ...plain, grade: { contrast: 0.6 } }, SRC)
    const noGrade = render('nograde', plain, SRC)
    const variance = (mp4: string) => {
      const r = spawnSync(FFMPEG, ['-v', 'error', '-ss', '1', '-i', mp4, '-frames:v', '1',
        '-vf', `crop=400:400:160:280,format=gray`, '-f', 'rawvideo', '-'],
        { encoding: 'buffer', maxBuffer: 64 * 1024 * 1024 })
      const b = r.stdout as unknown as Buffer
      let s = 0
      for (const v of b) s += v
      const m = s / b.length
      let q = 0
      for (const v of b) q += (v - m) ** 2
      return q / b.length
    }
    expect(variance(withGrade), `对比度没拉开: 有=${variance(withGrade)} 无=${variance(noGrade)}`)
      .toBeGreaterThan(variance(noGrade) * 1.2)
  })
})

describe('gradeChain', () => {
  // 每个滤镜实例都是一次全帧重采样；恒等滤镜是白付的成本
  it('空配置不产出恒等滤镜', () => {
    expect(gradeChain(undefined)).toBe('')
    expect(gradeChain({})).toBe('')
    expect(gradeChain({ contrast: 0, brightness: 0, saturation: 0 })).toBe('')
  })
  it('相对增量换算到 eq 的坐标系（contrast/saturation 中性值是 1）', () => {
    expect(gradeChain({ contrast: 0.2 })).toBe('eq=contrast=1.2')
    expect(gradeChain({ saturation: -0.1 })).toBe('eq=saturation=0.9')
    expect(gradeChain({ brightness: 0.05 })).toBe('eq=brightness=0.05')
  })
  it('锐化排在调色之后', () => {
    expect(gradeChain({ contrast: 0.2, sharpen: true })).toBe('eq=contrast=1.2,unsharp=5:5:0.8:5:5:0')
  })
})
