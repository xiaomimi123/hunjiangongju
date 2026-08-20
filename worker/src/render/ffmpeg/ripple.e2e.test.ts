// 水波纹预渲染的真渲验收：真画出 PNG 序列，断言**环确实在向外扩散**。
//
// 这类效果「写错了不报错，只是画面不对」，所以每条断言都要能指出具体哪里不对：
// 环没出现、环不动、环反着收缩——三种坏法在像素上表现不同，分别验。

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { spawnSync } from 'child_process'
import { mkdtempSync, rmSync, mkdirSync, readdirSync } from 'fs'
import os from 'os'
import path from 'path'
import { buildRippleAssetArgs, rippleAlphaExpr, rippleOverlayChain, type RippleAssetOpts } from './ripple'

const FFMPEG = process.env.FFMPEG_BIN ?? 'ffmpeg'
const d = process.env.RENDER_E2E === '1' ? describe : describe.skip
const W = 360   // 预渲染验收用半尺寸，geq 很慢且这里只验形态
const H = 480

function ff(args: string[]): { ok: boolean; out: string } {
  const r = spawnSync(FFMPEG, args, { encoding: 'utf8' })
  return { ok: r.status === 0, out: `${r.stdout ?? ''}${r.stderr ?? ''}` }
}

/** 某帧 PNG 里，距中心 [r1,r2) 环带内的平均 alpha */
function ringAlpha(png: string, r1: number, r2: number): number {
  // 直接把 alpha 通道抽成灰度，再在 Node 里按半径取样
  const r = spawnSync(FFMPEG, ['-v', 'error', '-i', png,
    '-vf', 'alphaextract,format=gray', '-f', 'rawvideo', '-'],
    { encoding: 'buffer', maxBuffer: 64 * 1024 * 1024 })
  const b = r.stdout as unknown as Buffer
  if (!b || b.length !== W * H) throw new Error(`抽 alpha 失败 ${png}: 得到 ${b?.length} 字节`)
  const cx = W / 2
  const cy = H / 2
  let sum = 0
  let n = 0
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const dist = Math.hypot(x - cx, y - cy)
      if (dist >= r1 && dist < r2) { sum += b[y * W + x]; n++ }
    }
  }
  return n ? sum / n : 0
}

d('真渲验收 —— 水波纹预渲染', () => {
  let dir = ''
  let frames: string[] = []
  const OPTS: RippleAssetOpts = { width: W, height: H, fps: 30, durationMs: 458, rings: 3, outPattern: '' }

  beforeAll(() => {
    dir = mkdtempSync(path.join(os.tmpdir(), 'mixcut-rp-'))
    const outDir = path.join(dir, 'seq')
    mkdirSync(outDir, { recursive: true })
    const o = { ...OPTS, outPattern: path.join(outDir, '%03d.png') }
    const r = ff(buildRippleAssetArgs(o))
    if (!r.ok) throw new Error(`预渲染失败: ${r.out.slice(-900)}`)
    frames = readdirSync(outDir).sort().map((f) => path.join(outDir, f))
  })

  afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }) })

  it('产出的帧数与 时长×帧率 相符', () => {
    expect(frames.length).toBeGreaterThanOrEqual(12)  // 458ms @30fps ≈ 14
    expect(frames.length).toBeLessThanOrEqual(16)
  })

  // ★ 环确实存在：早期帧里靠近中心的环带有明显 alpha
  it('早期帧：环在靠近中心处', () => {
    const early = frames[2]
    const inner = ringAlpha(early, 20, 70)
    const outer = ringAlpha(early, 180, 230)
    expect(inner, `早期帧中心附近没有环: ${inner}`).toBeGreaterThan(8)
    expect(outer, `早期帧外圈就已经有环了(环没有从中心出发): ${outer}`).toBeLessThan(inner)
  })

  // ★ 环在向外走：后期帧的能量重心移到外圈
  it('后期帧：环已扩散到外圈，中心附近清空', () => {
    const late = frames[frames.length - 3]
    const inner = ringAlpha(late, 20, 70)
    const outer = ringAlpha(late, 150, 220)
    expect(outer, `后期帧外圈没有环(环没有扩散): 内=${inner} 外=${outer}`).toBeGreaterThan(inner)
  })

  // ★ 反证：环数为 0 时整张图必须全透明。
  // 这条保证上面两条量的是「环」，而不是量到了底色。
  it('rings=0 时全透明（反证测量有效）', () => {
    const outDir = path.join(dir, 'zero')
    mkdirSync(outDir, { recursive: true })
    const r = ff(buildRippleAssetArgs({ ...OPTS, rings: 0, outPattern: path.join(outDir, '%03d.png') }))
    expect(r.ok, `渲染失败: ${r.out.slice(-400)}`).toBe(true)
    const f = readdirSync(outDir).sort().map((x) => path.join(outDir, x))
    expect(ringAlpha(f[Math.floor(f.length / 2)], 0, 200)).toBeLessThan(1)
  })

  it('rings=0 的表达式退化成常量 0，不产出无意义的 geq 计算', () => {
    expect(rippleAlphaExpr({ ...OPTS, rings: 0 })).toBe('0')
  })

  // 叠加链：序列被平移到指定时刻，且只在窗口内合成
  it('overlay 链把序列平移到指定时刻并限定窗口', () => {
    const c = rippleOverlayChain('base', 'out', 2, 3984, 458)
    expect(c).toContain('setpts=PTS-STARTPTS+3.984/TB')
    expect(c).toContain("enable='between(t,3.984,4.442)'")
    expect(c).toContain('eof_action=pass')
  })
})
