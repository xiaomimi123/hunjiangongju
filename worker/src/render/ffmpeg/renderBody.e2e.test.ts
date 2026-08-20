// 整条正片管线的真渲验收：图 → 运镜 → 转场 → 装饰 → 字幕，一次跑通并断言像素。
//
// 前面几个模块各自验过了，但**组合起来仍可能坏**：滤镜标签接错、装饰层输入下标算错、
// 字幕时间没左移……这些只有把整条链真跑一遍才看得见。阶段 1 的收口就是这个测试。

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { spawnSync } from 'child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import os from 'os'
import path from 'path'
import { buildRenderBodyPlan, type RenderBodySegment } from './renderBody'
import { minAdjacentChangedRatio } from './testkit'

const FFMPEG = process.env.FFMPEG_BIN ?? 'ffmpeg'
const d = process.env.RENDER_E2E === '1' ? describe : describe.skip
const W = 720
const H = 960

function ff(args: string[]): { ok: boolean; out: string } {
  const r = spawnSync(FFMPEG, args, { encoding: 'utf8' })
  return { ok: r.status === 0, out: `${r.stdout ?? ''}${r.stderr ?? ''}` }
}

function frameHash(mp4: string, atSec: number): string {
  const r = ff(['-v', 'error', '-ss', String(atSec), '-i', mp4, '-frames:v', '1', '-an', '-f', 'md5', '-'])
  const m = /MD5=([0-9a-f]+)/.exec(r.out)
  if (!m) throw new Error(`取帧失败 @${atSec}s: ${r.out.slice(-300)}`)
  return m[1]
}

function meanLuma(mp4: string, crop: string, atSec: number): number {
  const r = spawnSync(FFMPEG, ['-v', 'error', '-ss', String(atSec), '-i', mp4, '-frames:v', '1',
    '-vf', `crop=${crop},format=gray`, '-f', 'rawvideo', '-'],
    { encoding: 'buffer', maxBuffer: 64 * 1024 * 1024 })
  const b = r.stdout as unknown as Buffer
  if (!b || b.length === 0) throw new Error('取区域像素失败')
  let s = 0
  for (const v of b) s += v
  return s / b.length
}

d('真渲验收 —— 整条正片管线', () => {
  let dir = ''
  let out = ''

  // 正片从全片 4 秒处开始（前面是开场 + 快闪，由 HyperFrames 渲）
  const OFFSET = 4000
  const segs: RenderBodySegment[] = []

  beforeAll(() => {
    dir = mkdtempSync(path.join(os.tmpdir(), 'mixcut-rb-'))
    // 三张图：**必须有内容**（用 testsrc 的花纹），否则纯色图放大后每帧完全一样，
    // 运镜再对也验不出来——第一版就是用纯灰色写的，重复帧断言直接红。
    // 同时用 brightness 拉开三段的整体亮度，「换图了没有」才有得测。
    const bright = [-0.25, 0, 0.25]
    for (const [i, b] of bright.entries()) {
      const p = path.join(dir, `${i}.png`)
      const r = ff(['-v', 'error', '-f', 'lavfi', '-i', `testsrc=size=${W * 2}x${H * 2}:rate=1:duration=1`,
        '-vf', `eq=brightness=${b}`, '-frames:v', '1', '-y', p])
      if (!r.ok) throw new Error(`造图失败: ${r.out.slice(-300)}`)
      segs.push({
        imageAbs: p,
        startMs: OFFSET + i * 5000,
        endMs: OFFSET + (i + 1) * 5000,
        bookTitle: '简爱',
        captionBeats: [{ zh: `第${i + 1}段台词`, startMs: OFFSET + i * 5000 + 500, endMs: OFFSET + i * 5000 + 4000 }],
      })
    }

    const assAbs = path.join(dir, 's.ass')
    out = path.join(dir, 'body.mp4')
    const plan = buildRenderBodyPlan({
      segments: segs, width: W, height: H, fps: 30, timeOffsetMs: OFFSET,
      keyframes: [{ scaleFrom: 1, scaleTo: 1.108 }],
      bodyCycle: [{ renderType: 'crossfade', durationMs: 500 }],
      watermark: '@读书号',
      assStyle: { fontName: process.env.ASS_FONT ?? 'Noto Sans CJK SC', captionColor: '#ffffff',
        captionPosY: 0.78, captionSizePx: 48, titleSizePx: 52, titleColor: '#ffe9c0', watermarkSizePx: 22 },
      decor: { scrimHeightPx: 340, scrimAlpha: 0.85, vignette: true, grain: false },
      assAbs, outAbs: out,
    })
    writeFileSync(assAbs, plan.assContent, 'utf8')
    const r = ff(plan.args)
    if (!r.ok) throw new Error(`整条管线渲染失败: ${r.out.slice(-1000)}`)
  })

  afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }) })

  it('总时长 = 15s 扣掉两次 500ms 叠化 = 14s', () => {
    const p = spawnSync(process.env.FFPROBE_BIN ?? 'ffprobe',
      ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', out], { encoding: 'utf8' })
    expect(Math.abs(parseFloat(p.stdout) - 14)).toBeLessThan(0.2)
  })

  it('画面全程在动（运镜生效，没有任何一段定格）', () => {
    // 帧指纹在有纹理画面上是假绿(x264 逐帧调 QP)，用帧间平均绝对差，见 testkit.ts
    const m = minAdjacentChangedRatio(out, [1, 3, 6, 8, 11, 13])
    expect(m, `相邻采样之间画面几乎没变(疑似定格): 最小变化像素占比=${m}`).toBeGreaterThan(0.03)
  })

  // 三段底图用 eq=brightness -0.25/0/+0.25 拉开，换场后中部亮度应逐段升高。
  // 取画面中部避开压暗底与暗角的影响。
  it('三段确实换了图（中部亮度依次升高）', () => {
    const band = `300:200:210:300`
    const a = meanLuma(out, band, 2)
    const b = meanLuma(out, band, 7)
    const c = meanLuma(out, band, 12)
    expect(b, `第 2 段没换图: ${a} → ${b}`).toBeGreaterThan(a + 20)
    expect(c, `第 3 段没换图: ${b} → ${c}`).toBeGreaterThan(b + 20)
  })

  // ★ 字幕时间必须已左移。没左移的话第一条字幕会晚 4 秒出现。
  //
  // 用**高亮像素计数**而不是平均亮度：48px 的字在 720×150 的带里只把均值抬约 1.7，
  // 淹没在底图纹理的波动里（第一版就是这么写的，红了）。字是纯白、底图被压暗底压过，
  // 数「亮度 > 200 的像素」信噪比高得多。
  it('字幕按片段本地时间出现（timeOffsetMs 生效）', () => {
    const capBand = `${W}:150:0:${Math.round(H * 0.78) - 120}`
    const bright = (t: number) => {
      const r = spawnSync(FFMPEG, ['-v', 'error', '-ss', String(t), '-i', out, '-frames:v', '1',
        '-vf', `crop=${capBand},format=gray`, '-f', 'rawvideo', '-'],
        { encoding: 'buffer', maxBuffer: 64 * 1024 * 1024 })
      const b = r.stdout as unknown as Buffer
      let n = 0
      for (const v of b) if (v > 200) n++
      return n / b.length
    }
    const before = bright(0.2)   // 本地 0.2s：第一条字幕(0.5s)还没到
    const during = bright(2)     // 本地 2s：字幕在
    expect(during, `字幕没出现或时间没左移: 前=${before} 中=${during}`).toBeGreaterThan(before + 0.004)
  })

  it('压暗底生效（底部比中部暗）', () => {
    const bottom = meanLuma(out, `${W}:80:0:${H - 80}`, 2)
    const middle = meanLuma(out, `${W}:80:0:${Math.round(H / 2)}`, 2)
    expect(bottom).toBeLessThan(middle - 15)
  })

  it('暗角生效（四角比中心暗）', () => {
    const corner = meanLuma(out, `120:120:0:0`, 2)
    const center = meanLuma(out, `160:160:${(W - 160) / 2}:${(H - 160) / 2}`, 2)
    expect(corner).toBeLessThan(center - 10)
  })
})
