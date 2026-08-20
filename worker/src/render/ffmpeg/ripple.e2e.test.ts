// 水波纹预渲染的真渲验收：真画出 PNG 序列，断言**环确实在向外扩散**。
//
// 这类效果「写错了不报错，只是画面不对」，所以每条断言都要能指出具体哪里不对：
// 环没出现、环不动、环反着收缩——三种坏法在像素上表现不同，分别验。

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { spawnSync } from 'child_process'
import { mkdtempSync, rmSync, mkdirSync, readdirSync } from 'fs'
import os from 'os'
import path from 'path'
import { buildRippleAssetArgs, rippleAlphaExpr, rippleOverlayChain, buildRippleDisplaceArgs, rippleDisplaceExpr, type RippleAssetOpts } from './ripple'

const FFMPEG = process.env.FFMPEG_BIN ?? 'ffmpeg'
const d = process.env.RENDER_E2E === '1' ? describe : describe.skip
const W = 360   // 预渲染验收用半尺寸，geq 很慢且这里只验形态
const H = 480

function ff(args: string[]): { ok: boolean; out: string } {
  const r = spawnSync(FFMPEG, args, { encoding: 'utf8' })
  return { ok: r.status === 0, out: `${r.stdout ?? ''}${r.stderr ?? ''}` }
}

/**
 * 某帧 PNG 里「环所在的半径」——alpha 加权的平均半径。
 *
 * 比「固定环带里的平均 alpha」稳健得多：后者的测量带是按某一版环宽标定的，
 * 环一调细就跑到带外、两边都接近 0，断言失去意义（第一版就是这么写的，
 * 把 RING_W 从 26 调到 13 之后直接红了）。峰值半径与环宽、透明度都无关。
 */
function ringRadius(png: string): number {
  const b = alphaBuf(png)
  const cx = W / 2
  const cy = H / 2
  let sum = 0
  let wsum = 0
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const a = b[y * W + x]
      if (a <= 8) continue
      sum += Math.hypot(x - cx, y - cy) * a
      wsum += a
    }
  }
  return wsum ? sum / wsum : 0
}

function alphaBuf(png: string): Buffer {
  const r = spawnSync(FFMPEG, ['-v', 'error', '-i', png,
    '-vf', 'alphaextract,format=gray', '-f', 'rawvideo', '-'],
    { encoding: 'buffer', maxBuffer: 64 * 1024 * 1024 })
  const b = r.stdout as unknown as Buffer
  if (!b || b.length !== W * H) throw new Error(`抽 alpha 失败 ${png}: 得到 ${b?.length} 字节`)
  return b
}

/** 某帧 PNG 里，距中心 [r1,r2) 环带内的平均 alpha */
function ringAlpha(png: string, r1: number, r2: number): number {
  const b = alphaBuf(png)
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

  // ★ 环确实存在，且从中心附近出发
  it('早期帧：环在靠近中心处', () => {
    const r = ringRadius(frames[2])
    expect(r, `早期帧没有可测的环: ${r}`).toBeGreaterThan(0)
    expect(r, `环一上来就在外圈(没有从中心出发): ${r}`).toBeLessThan(H / 4)
  })

  // ★ 环在向外走：半径随时间单调外移
  it('环随时间向外扩散（半径逐帧变大）', () => {
    const rs = [2, 5, 8, frames.length - 3].map((i) => ringRadius(frames[i]))
    for (let i = 1; i < rs.length; i++) {
      expect(rs[i], `第 ${i} 个采样点半径没有变大: ${JSON.stringify(rs.map((x) => Math.round(x)))}`)
        .toBeGreaterThan(rs[i - 1])
    }
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

// 位移层：断言它**真的把底图推开了**，而不只是画了一圈白环。
d('真渲验收 —— 水波纹位移层', () => {
  let dir = ''
  const OPTS: RippleAssetOpts = { width: W, height: H, fps: 30, durationMs: 458, rings: 3, outPattern: '' }

  beforeAll(() => { dir = mkdtempSync(path.join(os.tmpdir(), 'mixcut-rpd-')) })
  afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }) })

  it('位移图以 128 为零位移，环处偏离 128', () => {
    const out = path.join(dir, 'x%03d.png')
    const r = ff(buildRippleDisplaceArgs(OPTS, 'x', out))
    expect(r.ok, `位移图渲染失败: ${r.out.slice(-400)}`).toBe(true)
    const f = readdirSync(dir).filter((x) => x.startsWith('x')).sort().map((x) => path.join(dir, x))
    const b = spawnSync(FFMPEG, ['-v', 'error', '-i', f[5], '-vf', 'format=gray', '-f', 'rawvideo', '-'],
      { encoding: 'buffer', maxBuffer: 1 << 26 }).stdout as unknown as Buffer
    let far = 0
    for (const v of b) if (Math.abs(v - 128) > 6) far++
    // 环所在的一圈应有可观比例偏离 128；全是 128 说明位移根本没算出来
    expect(far / b.length, `位移图几乎全是 128（没有位移）: ${far / b.length}`).toBeGreaterThan(0.01)
  })

  // ★ 反证：rings=0 时位移图必须处处是 128，否则上面那条量的不是「环」
  it('rings=0 时位移图处处为 128（反证）', () => {
    expect(rippleDisplaceExpr({ ...OPTS, rings: 0 }, 'x')).toBe('128')
  })

  // ★ 真把画面推开了：同一张底图过 displace 前后必须不同，且差异集中在环上
  it('displace 真的折射底图', () => {
    const bg = path.join(dir, 'bg.png')
    expect(ff(['-v', 'error', '-f', 'lavfi', '-i', `testsrc=size=${W}x${H}:rate=1:duration=1`,
      '-frames:v', '1', '-y', bg]).ok).toBe(true)
    const xm = path.join(dir, 'dx.png')
    const ym = path.join(dir, 'dy.png')
    ff(buildRippleDisplaceArgs(OPTS, 'x', xm.replace('.png', '%03d.png')))
    ff(buildRippleDisplaceArgs(OPTS, 'y', ym.replace('.png', '%03d.png')))
    const x5 = path.join(dir, 'dx006.png')
    const y5 = path.join(dir, 'dy006.png')
    const out = path.join(dir, 'disp.png')
    const r = ff(['-y', '-i', bg, '-i', x5, '-i', y5,
      '-filter_complex', '[0][1][2]displace=edge=smear', '-frames:v', '1', out])
    expect(r.ok, `displace 失败: ${r.out.slice(-500)}`).toBe(true)
    const px = (f: string) => spawnSync(FFMPEG, ['-v', 'error', '-i', f, '-vf', 'format=gray', '-f', 'rawvideo', '-'],
      { encoding: 'buffer', maxBuffer: 1 << 26 }).stdout as unknown as Buffer
    const a = px(bg)
    const b = px(out)
    let diff = 0
    for (let i = 0; i < Math.min(a.length, b.length); i++) if (Math.abs(a[i] - b[i]) > 12) diff++
    expect(diff / a.length, `displace 后画面没变（位移没生效）: ${diff / a.length}`).toBeGreaterThan(0.01)
  })
})
