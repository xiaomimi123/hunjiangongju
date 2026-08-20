// 混合方案总装的真渲验收：开场片段 + 快闪 + 正片，一条命令产出完整无声视频。
//
// 这是整个迁移里最容易出错的一环：输入下标偏移、内部标签重名、concat 时基不一致、
// 字幕用错时间基准……每一样错了都不会报错，只会画面/字幕悄悄错位。

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { spawnSync } from 'child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import os from 'os'
import path from 'path'
import { buildRenderFullPlan, type RenderFullOpts } from './renderFull'
import { changedRatio, minAdjacentChangedRatio, STILL_RATIO } from './testkit'

const FFMPEG = process.env.FFMPEG_BIN ?? 'ffmpeg'
const d = process.env.RENDER_E2E === '1' ? describe : describe.skip
const W = 720
const H = 960

function ff(args: string[]): { ok: boolean; out: string } {
  const r = spawnSync(FFMPEG, args, { encoding: 'utf8' })
  return { ok: r.status === 0, out: `${r.stdout ?? ''}${r.stderr ?? ''}` }
}
function meanLuma(mp4: string, atSec: number, crop = `240:240:240:360`): number {
  const r = spawnSync(FFMPEG, ['-v', 'error', '-ss', String(atSec), '-i', mp4, '-frames:v', '1',
    '-vf', `crop=${crop},format=gray`, '-f', 'rawvideo', '-'],
    { encoding: 'buffer', maxBuffer: 64 * 1024 * 1024 })
  const b = r.stdout as unknown as Buffer
  if (!b || b.length === 0) throw new Error(`取像素失败 @${atSec}`)
  let s = 0
  for (const v of b) s += v
  return s / b.length
}

d('真渲验收 —— 混合方案总装', () => {
  let dir = ''
  let out = ''
  // 开场 0~2s（HyperFrames 那段）→ 快闪 2~2.8s（4 卡）→ 正片 2.8~11.8s（3 段）
  const OPEN_MS = 2000
  const FLASH_MS = 800
  const BODY_SEG = 3000

  beforeAll(() => {
    dir = mkdtempSync(path.join(os.tmpdir(), 'mixcut-full-'))
    // 开场片段：模拟 HyperFrames 的产物，**故意用不同尺寸和帧率**，
    // 验证归一化那一步是真的在起作用
    const openAbs = path.join(dir, 'open.mp4')
    let r = ff(['-v', 'error', '-f', 'lavfi', '-i', `testsrc=size=640x480:rate=25:duration=${OPEN_MS / 1000}`,
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-y', openAbs])
    if (!r.ok) throw new Error(`造开场失败: ${r.out.slice(-300)}`)

    // 快闪封面 4 张 + 正片配图 3 张，亮度阶梯分明
    const mk = (name: string, b: number) => {
      const p = path.join(dir, `${name}.png`)
      const rr = ff(['-v', 'error', '-f', 'lavfi', '-i', `testsrc=size=${W * 2}x${H * 2}:rate=1:duration=1`,
        '-vf', `eq=brightness=${b}`, '-frames:v', '1', '-y', p])
      if (!rr.ok) throw new Error(`造图失败: ${rr.out.slice(-300)}`)
      return p
    }
    // 快闪一律偏暗、正片一律偏亮，两组不重叠 —— 这样「哪一段在播」用亮度就判得出来。
    // （第一版让两组取值交叠了：快闪第 3 张 -0.1 比正片第 1 段 -0.2 还亮，断言自然红。）
    const covers = [0, 1, 2, 3].map((i) => mk(`c${i}`, -0.45 + i * 0.05))
    const bodies = [0, 1, 2].map((i) => mk(`b${i}`, 0.0 + i * 0.2))

    const opts: RenderFullOpts = {
      openingClipAbs: openAbs,
      flashCards: covers.map((c, i) => ({
        coverAbs: c, title: `书${i + 1}`, author: `作者${i + 1}`,
        startMs: OPEN_MS + i * (FLASH_MS / 4), endMs: OPEN_MS + (i + 1) * (FLASH_MS / 4),
      })),
      bodySegments: bodies.map((b, i) => ({
        imageAbs: b,
        startMs: OPEN_MS + FLASH_MS + i * BODY_SEG,
        endMs: OPEN_MS + FLASH_MS + (i + 1) * BODY_SEG,
        bookTitle: '简爱',
        captionBeats: [{ zh: `第${i + 1}句台词`,
          startMs: OPEN_MS + FLASH_MS + i * BODY_SEG + 300,
          endMs: OPEN_MS + FLASH_MS + (i + 1) * BODY_SEG - 300 }],
      })),
      width: W, height: H, fps: 30,
      keyframes: [{ scaleFrom: 1, scaleTo: 1.108 }],
      flashBounceIn: false,
      watermark: '@读书号',
      assStyle: { fontName: process.env.ASS_FONT ?? 'Noto Sans CJK SC', captionColor: '#ffffff',
        captionPosY: 0.78, captionSizePx: 46, titleSizePx: 50, titleColor: '#ffe9c0', watermarkSizePx: 22,
        flashTitleSizePx: 58, flashTitleColor: '#ffffff', flashAuthorSizePx: 26, flashAuthorColor: '#ffcc88' },
      decor: { scrimHeightPx: 340, scrimAlpha: 0.85, vignette: true, grain: false },
      assAbs: path.join(dir, 's.ass'),
      outAbs: path.join(dir, 'body.mp4'),
    }
    const plan = buildRenderFullPlan(opts)
    writeFileSync(opts.assAbs, plan.assContent, 'utf8')
    r = ff(plan.args)
    if (!r.ok) throw new Error(`总装渲染失败: ${r.out.slice(-1200)}`)
    out = opts.outAbs
    expect(plan.totalMs).toBe(OPEN_MS + FLASH_MS + BODY_SEG * 3)
  })

  afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }) })

  it('总时长 = 开场 + 快闪 + 正片', () => {
    const p = spawnSync(process.env.FFPROBE_BIN ?? 'ffprobe',
      ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', out], { encoding: 'utf8' })
    expect(Math.abs(parseFloat(p.stdout) - 11.8)).toBeLessThan(0.2)
  })

  it('产出 720×960 且无音轨（音频由 render-video 统一混）', () => {
    const p = spawnSync(process.env.FFPROBE_BIN ?? 'ffprobe',
      ['-v', 'error', '-show_entries', 'stream=codec_type,width,height', '-of', 'csv=p=0', out], { encoding: 'utf8' })
    expect(p.stdout).toContain('720,960')
    expect(p.stdout).not.toContain('audio')
  })

  // ★ 开场那段尺寸/帧率都不同，归一化没生效的话 concat 直接失败或画面变形
  it('开场段被归一化后正常播放（不同尺寸/帧率的输入也能拼进来）', () => {
    const m = changedRatio(out, 0.3, 1.5)
    expect(m, `开场段画面没变化，归一化可能把它压成静帧: ${m}`).toBeGreaterThan(STILL_RATIO)
  })

  // ★ 三段各自的画面确实出现在自己的时间窗内
  it('三段按时间先后依次出现（亮度阶梯对得上）', () => {
    const flashMid = (OPEN_MS + 400) / 1000      // 快闪中段
    const body1 = (OPEN_MS + FLASH_MS + 1500) / 1000
    const body3 = (OPEN_MS + FLASH_MS + BODY_SEG * 2 + 1500) / 1000
    const a = meanLuma(out, flashMid)
    const b = meanLuma(out, body1)
    const c = meanLuma(out, body3)
    expect(b, `正片第 1 段没接上: 快闪=${a} 正片1=${b}`).toBeGreaterThan(a)
    expect(c, `正片第 3 段没接上: 正片1=${b} 正片3=${c}`).toBeGreaterThan(b)
  })

  it('正片全程在动（运镜生效）', () => {
    const t0 = (OPEN_MS + FLASH_MS) / 1000
    const m = minAdjacentChangedRatio(out, [t0 + 0.5, t0 + 2, t0 + 4, t0 + 6, t0 + 8])
    expect(m, `正片有时段定格: 最小变化像素占比=${m}`).toBeGreaterThan(0.02)
  })

  // ★ 字幕用全片绝对时间：正片第 1 句在 3.1~5.5s，快闪那会儿(2.4s)不该有正文字幕
  it('正文字幕按全片绝对时间出现', () => {
    const capBand = `${W}:140:0:${Math.round(H * 0.78) - 110}`
    const bright = (t: number) => {
      const r = spawnSync(FFMPEG, ['-v', 'error', '-ss', String(t), '-i', out, '-frames:v', '1',
        '-vf', `crop=${capBand},format=gray`, '-f', 'rawvideo', '-'],
        { encoding: 'buffer', maxBuffer: 64 * 1024 * 1024 })
      const b = r.stdout as unknown as Buffer
      let n = 0
      for (const v of b) if (v > 200) n++
      return n / b.length
    }
    const duringFlash = bright(2.4)                       // 快闪段：底部不该有正文字幕
    const duringBody = bright((OPEN_MS + FLASH_MS + 1500) / 1000)
    expect(duringBody, `正片字幕没出现: 快闪时=${duringFlash} 正片时=${duringBody}`)
      .toBeGreaterThan(duringFlash + 0.004)
  })
})
