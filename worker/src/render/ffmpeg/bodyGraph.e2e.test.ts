// 正片滤镜图的真渲验收：真跑一遍 ffmpeg，断言**渲出来的像素**。
//
// 为什么不能只有单测：bodyGraph.test.ts 断言的是拼出来的滤镜字符串。线上刚栽过一次
// ——字符串完全正确，是 ffmpeg 执行它的行为出了问题，826 个单测全绿而每条成片都是坏的。
// 迁移之后「整个产品就等于那张滤镜图」，这层必须有。
//
// 默认跳过：RENDER_E2E=1 开启；权威口径是在 worker 容器里跑（ffmpeg 与生产同一个二进制）。

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { spawnSync } from 'child_process'
import { mkdtempSync, rmSync } from 'fs'
import os from 'os'
import path from 'path'
import { buildBodyGraph, type FfBodySegment } from './bodyGraph'
import { changedRatio, minAdjacentChangedRatio, STILL_RATIO } from './testkit'

const FFMPEG = process.env.FFMPEG_BIN ?? 'ffmpeg'
const d = process.env.RENDER_E2E === '1' ? describe : describe.skip

function ff(args: string[]): { ok: boolean; out: string } {
  const r = spawnSync(FFMPEG, args, { encoding: 'utf8' })
  return { ok: r.status === 0, out: `${r.stdout ?? ''}${r.stderr ?? ''}` }
}

/** 单帧像素指纹。`-an` 见 renderVideo.e2e.test.ts 的说明——带音轨时不加会变成假绿。 */
function frameHash(mp4: string, atSec: number): string {
  const r = ff(['-v', 'error', '-ss', String(atSec), '-i', mp4, '-frames:v', '1', '-an', '-f', 'md5', '-'])
  const m = /MD5=([0-9a-f]+)/.exec(r.out)
  if (!m) throw new Error(`取帧失败 @${atSec}s: ${r.out.slice(-300)}`)
  return m[1]
}

function durationSec(mp4: string): number {
  const p = spawnSync(process.env.FFPROBE_BIN ?? 'ffprobe',
    ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', mp4], { encoding: 'utf8' })
  return parseFloat((p.stdout ?? '').trim())
}

/** 渲染一组分镜，返回成片路径 */
function render(dir: string, segments: FfBodySegment[], name: string): string {
  const out = path.join(dir, `${name}.mp4`)
  const g = buildBodyGraph({ segments, width: 720, height: 960, fps: 30 })
  const r = ff(['-y', ...g.inputArgs, '-filter_complex', g.filter,
    '-map', `[${g.outLabel}]`, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '28',
    '-pix_fmt', 'yuv420p', out])
  if (!r.ok) throw new Error(`渲染失败: ${r.out.slice(-800)}`)
  return out
}

d('真渲验收 —— 正片滤镜图', () => {
  let dir = ''
  const img: string[] = []

  beforeAll(() => {
    dir = mkdtempSync(path.join(os.tmpdir(), 'mixcut-bg-'))
    // 三张**内容截然不同**的静图：换场没发生的话，帧指纹会暴露
    for (const [i, c] of ['red', 'green', 'blue'].entries()) {
      const p = path.join(dir, `${i}.png`)
      const r = ff(['-v', 'error', '-f', 'lavfi', '-i', `testsrc=size=720x960:rate=1:duration=1`,
        '-vf', `hue=h=${i * 120},drawbox=c=${c}@0.6:t=fill`, '-frames:v', '1', '-y', p])
      if (!r.ok) throw new Error(`造图失败: ${r.out.slice(-300)}`)
      img.push(p)
    }
  })

  afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }) })

  it('总时长与 buildBodyGraph 算出的 totalMs 一致（xfade 吃掉的时长要对得上）', () => {
    const segs: FfBodySegment[] = [
      { imageAbs: img[0], durationMs: 3000 },
      { imageAbs: img[1], durationMs: 3000, transitionIn: null },
      { imageAbs: img[2], durationMs: 3000, transitionIn: 'crossfade', transitionMs: 500 },
    ]
    const g = buildBodyGraph({ segments: segs, width: 720, height: 960, fps: 30 })
    expect(g.totalMs).toBe(8500)
    const out = render(dir, segs, 'dur')
    expect(Math.abs(durationSec(out) - 8.5)).toBeLessThan(0.15)
  })

  // ★ 运镜真的在动。段内两个时刻像素相同 = 运镜没生效（或又被冻住了）
  it('运镜段内画面持续变化', () => {
    const segs: FfBodySegment[] = [
      { imageAbs: img[0], durationMs: 6000, motion: { scaleFrom: 1, scaleTo: 1.108 } },
    ]
    const out = render(dir, segs, 'motion')
    const m = minAdjacentChangedRatio(out, [0.5, 2, 3.5, 5])
    expect(m, `运镜段内画面几乎没变(运镜没生效): 最小变化像素占比=${m}`).toBeGreaterThan(0.03)
  })

  // ★ 对照组：显式声明静止的段**应该**是定格的。
  // 这条同时证明上一条断言有牙齿——同一套取帧逻辑，静止段能验出重复。
  it('静止段确实定格（反证上一条断言有效）', () => {
    const segs: FfBodySegment[] = [{ imageAbs: img[0], durationMs: 6000 }]
    const out = render(dir, segs, 'still')
    const m = changedRatio(out, 0.5, 5)
    expect(m, `静止段却在动，说明测量失效: 变化像素占比=${m}`).toBeLessThan(STILL_RATIO)
  })

  it('硬切在预期时刻换图，前后两侧画面不同', () => {
    const segs: FfBodySegment[] = [
      { imageAbs: img[0], durationMs: 3000 },
      { imageAbs: img[1], durationMs: 3000, transitionIn: null },
    ]
    const out = render(dir, segs, 'cut')
    // 切点 3.0s：前后各取一帧必须不同
    expect(frameHash(out, 2.5)).not.toBe(frameHash(out, 3.5))
    // 同一段内（都静止）必须相同——切点没跑偏
    expect(frameHash(out, 1.0)).toBe(frameHash(out, 2.5))
    expect(frameHash(out, 3.5)).toBe(frameHash(out, 5.5))
  })

  it('叠化在切点附近产生过渡帧（既不同于前段也不同于后段）', () => {
    const segs: FfBodySegment[] = [
      { imageAbs: img[0], durationMs: 3000 },
      { imageAbs: img[2], durationMs: 3000, transitionIn: 'crossfade', transitionMs: 600 },
    ]
    const out = render(dir, segs, 'xfade')
    const before = frameHash(out, 1.5)   // 纯前段
    const mid = frameHash(out, 2.7)      // 转场窗口内(2.4~3.0)
    const after = frameHash(out, 4.5)    // 纯后段
    expect(mid).not.toBe(before)
    expect(mid).not.toBe(after)
    expect(before).not.toBe(after)
  })
})
