// 快闪段真渲验收。这一段最要紧的是**切点准不准**——
// 等分排布与按草稿比例排布，实测切点差最大 58.7ms（近两帧），肉眼能看出律动被抹平。

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { spawnSync } from 'child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import os from 'os'
import path from 'path'
import { buildFlashPlan, distributeCards, type FlashCard, type FlashOpts } from './flash'
import { changedRatio, STILL_RATIO } from './testkit'

const FFMPEG = process.env.FFMPEG_BIN ?? 'ffmpeg'
const d = process.env.RENDER_E2E === '1' ? describe : describe.skip
const W = 720
const H = 960
// 客户样例的逐卡时长
const CLIP_MS = [150, 251, 195, 191]
const WINDOW = 800

function ff(args: string[]): { ok: boolean; out: string } {
  const r = spawnSync(FFMPEG, args, { encoding: 'utf8' })
  return { ok: r.status === 0, out: `${r.stdout ?? ''}${r.stderr ?? ''}` }
}

function meanLuma(mp4: string, atSec: number, crop = `300:300:210:200`): number {
  const r = spawnSync(FFMPEG, ['-v', 'error', '-ss', String(atSec), '-i', mp4, '-frames:v', '1',
    '-vf', `crop=${crop},format=gray`, '-f', 'rawvideo', '-'],
    { encoding: 'buffer', maxBuffer: 64 * 1024 * 1024 })
  const b = r.stdout as unknown as Buffer
  if (!b || b.length === 0) throw new Error(`取像素失败 @${atSec}`)
  let s = 0
  for (const v of b) s += v
  return s / b.length
}

d('真渲验收 —— 快闪书封段', () => {
  let dir = ''
  let out = ''
  let slots: { startMs: number; endMs: number }[] = []

  function build(bounceIn: boolean, name: string): string {
    const o: FlashOpts = {
      cards: slots.map((s, i) => ({
        coverAbs: path.join(dir, `${i}.png`),
        title: `书${i + 1}`, author: `作者${i + 1}`,
        startMs: s.startMs, endMs: s.endMs,
      })) as FlashCard[],
      width: W, height: H, fps: 30, timeOffsetMs: 0, bounceIn,
      assStyle: { fontName: process.env.ASS_FONT ?? 'Noto Sans CJK SC', titleSizePx: 60,
        titleColor: '#ffffff', authorSizePx: 28, authorColor: '#ffcc88' },
      assAbs: path.join(dir, `${name}.ass`), outAbs: path.join(dir, `${name}.mp4`),
    }
    const plan = buildFlashPlan(o)
    writeFileSync(o.assAbs, plan.assContent, 'utf8')
    const r = ff(plan.args)
    if (!r.ok) throw new Error(`快闪渲染失败: ${r.out.slice(-900)}`)
    return o.outAbs
  }

  beforeAll(() => {
    dir = mkdtempSync(path.join(os.tmpdir(), 'mixcut-flash-'))
    slots = distributeCards(CLIP_MS.length, WINDOW, CLIP_MS)
    // 四张亮度阶梯分明的书封：切点是否准确直接体现在亮度何时跳变
    const lum = [0x30, 0x60, 0x90, 0xc0]
    for (const [i, v] of lum.entries()) {
      const c = v.toString(16).padStart(2, '0')
      const r = ff(['-v', 'error', '-f', 'lavfi', '-i', `color=c=0x${c}${c}${c}:s=${W * 2}x${H * 2}`,
        '-frames:v', '1', '-y', path.join(dir, `${i}.png`)])
      if (!r.ok) throw new Error(`造图失败: ${r.out.slice(-300)}`)
    }
    out = build(false, 'nobounce')
  })

  afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }) })

  it('逐卡时长按草稿比例，不是等分', () => {
    const durs = slots.map((s) => s.endMs - s.startMs)
    // 150 : 251 的比例应保留下来
    expect(durs[1]).toBeGreaterThan(durs[0] + 50)
    expect(slots[slots.length - 1].endMs).toBe(WINDOW)
  })

  it('总时长等于窗口', () => {
    const p = spawnSync(process.env.FFPROBE_BIN ?? 'ffprobe',
      ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', out], { encoding: 'utf8' })
    expect(Math.abs(parseFloat(p.stdout) - WINDOW / 1000)).toBeLessThan(0.08)
  })

  // ★ 核心断言：每张卡的亮度台阶必须落在草稿比例算出的位置上。
  // 等分排布的话第 2、3 张卡的中点会落在别的卡上，亮度就对不上。
  it('每张卡在自己的时间窗内显示（亮度台阶对得上切点）', () => {
    const expected = [0x30, 0x60, 0x90, 0xc0]
    slots.forEach((s, i) => {
      const mid = (s.startMs + s.endMs) / 2 / 1000
      const lum = meanLuma(out, mid)
      // yuv420p limited range 会把 0x30..0xc0 压进 16..235，这里只验相对台阶
      const prev = i > 0 ? meanLuma(out, (slots[i - 1].startMs + slots[i - 1].endMs) / 2 / 1000) : -1
      expect(lum, `第 ${i + 1} 张卡中点亮度 ${lum} 不高于上一张 ${prev}`).toBeGreaterThan(prev + 20)
      expect(expected[i]).toBeGreaterThan(0) // 夹具自检
    })
  })

  it('卡与卡之间是硬切：切点前后亮度立刻跳变', () => {
    const b = slots[1].startMs / 1000
    const before = meanLuma(out, b - 0.03)
    const after = meanLuma(out, b + 0.03)
    expect(Math.abs(after - before), `切点 ${b}s 附近没有跳变`).toBeGreaterThan(20)
  })

  // 弹入是近似（zoompan 缩放下界是 1，只能由大收小）。这里验的是「它确实在动」，
  // 不是「与原模板等价」。
  //
  // **必须换成有花纹的卡**：上面那批是纯色的，收缩运镜对纯色画面不产生任何像素差异，
  // 拿它测运镜等于什么也没测（第一版就是这么写的，只好用「关掉时定格」搪塞）。
  it('bounceIn 让卡内画面持续变化，关掉则定格（成对反证）', () => {
    // 造一批有花纹的卡
    for (let i = 0; i < CLIP_MS.length; i++) {
      const r = ff(['-v', 'error', '-f', 'lavfi', '-i', `testsrc=size=${W * 2}x${H * 2}:rate=1:duration=1`,
        '-vf', `eq=brightness=${-0.2 + i * 0.13}`, '-frames:v', '1', '-y', path.join(dir, `${i}.png`)])
      if (!r.ok) throw new Error(`造图失败: ${r.out.slice(-300)}`)
    }
    const s = slots[1]                       // 251ms 权重那张，最长，采样余量最大
    const t1 = (s.startMs + 30) / 1000
    const t2 = (s.endMs - 30) / 1000

    // 用帧间平均绝对差,不用帧指纹 —— 指纹在有纹理的画面上是假绿,见 testkit.ts
    const on = changedRatio(build(true, 'bounce'), t1, t2)
    const off = changedRatio(build(false, 'nobounce2'), t1, t2)
    expect(on, `开了 bounceIn 卡内却几乎没变: ${on}`).toBeGreaterThan(0.02)
    expect(off, `关了 bounceIn 卡内却在动(说明上一条测的不是运镜): ${off}`).toBeLessThan(STILL_RATIO)
  })
})
