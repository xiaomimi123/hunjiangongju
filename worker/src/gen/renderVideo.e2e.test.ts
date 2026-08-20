// 真渲验收：**真的跑一遍 ffmpeg，断言渲出来的像素与声音**，而不是断言参数字符串。
//
// 为什么必须有这层：线上出过一次全线事故——每条成片从约 2 秒起画面定格、字幕整条消失，
// 而当时 826 个单元测试全绿。因为它们断言的是 `buildFfmpegArgs` 拼出来的字符串，
// 那串字符串完全正确；错的是那个 ffmpeg 二进制执行它的行为。
// 参数对 ≠ 画面对。迁移到 FFmpeg 渲染之后，**整个产品就等于那张滤镜图**，
// 这个盲区会从「一个装饰效果出错」放大成「每条片子的画面都可能静默出错」。
//
// 默认跳过：要真跑 ffmpeg、耗几秒 CPU，不该拖慢日常单测。
//   本地：RENDER_E2E=1 npx vitest run worker/src/gen/renderVideo.e2e.test.ts
//   权威口径：在 worker 容器里跑，那里的 ffmpeg 与生产是同一个钉死的二进制
//            docker compose run --rm worker npm run test:render -w worker
//
// 用 FFMPEG_BIN 覆盖二进制路径，便于指向特定版本做对照实验。

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { spawnSync } from 'child_process'
import { mkdtempSync, rmSync, existsSync } from 'fs'
import os from 'os'
import path from 'path'
import { buildFfmpegArgs } from './renderVideo'
import { minAdjacentChangedRatio, STILL_RATIO } from '../render/ffmpeg/testkit'

const FFMPEG = process.env.FFMPEG_BIN ?? 'ffmpeg'
const ENABLED = process.env.RENDER_E2E === '1'
const d = ENABLED ? describe : describe.skip

function ff(args: string[]): { ok: boolean; out: string } {
  const r = spawnSync(FFMPEG, args, { encoding: 'utf8' })
  return { ok: r.status === 0, out: `${r.stdout ?? ''}${r.stderr ?? ''}` }
}

/**
 * 某一时刻单帧的 md5。用它比对「画面到底变没变」——冻帧一验就现形。
 *
 * **`-an` 不能省。** `-f md5` 会把复用进容器的所有流一起哈希；成片带音轨，
 * 音频逐时刻不同，于是哪怕画面完全冻结、指纹也各不相同——「帧互不相同」那条断言
 * 就变成永远通过的假绿。这是写这个测试时用「故意造一段定格画面」验出来的，
 * 不是推理出来的。改动这里前请先用定格输入确认断言仍会红。
 */
function frameHash(mp4: string, atSec: number): string {
  const r = ff(['-v', 'error', '-ss', String(atSec), '-i', mp4, '-frames:v', '1', '-an', '-f', 'md5', '-'])
  const m = /MD5=([0-9a-f]+)/.exec(r.out)
  if (!m) throw new Error(`取帧失败 @${atSec}s: ${r.out.slice(-300)}`)
  return m[1]
}

/** 有声区间（秒）。用来验音效落位——齿轮/水滴放错段落会直接体现在这里。 */
function soundWindows(mp4: string): { start: number; end: number }[] {
  const r = ff(['-v', 'info', '-i', mp4, '-af', 'silencedetect=noise=-50dB:d=0.05', '-f', 'null', '-'])
  const starts = [...r.out.matchAll(/silence_end:\s*([0-9.]+)/g)].map((x) => parseFloat(x[1]))
  const ends = [...r.out.matchAll(/silence_start:\s*([0-9.]+)/g)].map((x) => parseFloat(x[1]))
  const out: { start: number; end: number }[] = []
  for (const s of starts) {
    const e = ends.find((x) => x > s)
    if (e !== undefined) out.push({ start: s, end: e })
  }
  return out
}

d('真渲验收 —— 混音阶段', () => {
  let dir = ''
  let body = ''
  let voice = ''
  let out = ''
  const GEAR = path.resolve(__dirname, '../../assets/sfx/gear.mp3')
  const DROP = path.resolve(__dirname, '../../assets/sfx/drop.mp3')

  // 与客户样例对齐的节拍：开场 0→2.159s，快闪 2.159→3.984s，正片 3.984s 起
  const OPEN_END = 2.159
  const FLASH_END = 3.984
  const DUR = 12

  beforeAll(() => {
    dir = mkdtempSync(path.join(os.tmpdir(), 'mixcut-e2e-'))
    body = path.join(dir, 'body.mp4')
    voice = path.join(dir, 'voice.wav')
    out = path.join(dir, 'final.mp4')

    // 每帧都不同的测试画面：冻帧一旦发生，帧 md5 会立刻重复
    const b = ff(['-v', 'error', '-f', 'lavfi', '-i', `testsrc=size=720x960:rate=30:duration=${DUR}`,
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-y', body])
    if (!b.ok) throw new Error(`造 body.mp4 失败: ${b.out.slice(-400)}`)
    // 人声轨用静音：这样有声区间里只剩音效，落位偏差看得一清二楚
    const v = ff(['-v', 'error', '-f', 'lavfi', '-i', `anullsrc=r=48000:cl=stereo`, '-t', String(DUR), '-y', voice])
    if (!v.ok) throw new Error(`造 voice.wav 失败: ${v.out.slice(-400)}`)

    const args = buildFfmpegArgs({
      bodyAbs: body, audioAbs: voice, bgmAbs: null, durSec: DUR, outAbs: out,
      sfx: { gearAbs: GEAR, dropAbs: DROP, openEndSec: OPEN_END, flashEndSec: FLASH_END, dropAtSec: FLASH_END },
    })
    const r = ff(args)
    if (!r.ok) throw new Error(`渲染失败: ${r.out.slice(-600)}`)
  })

  afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }) })

  it('音效素材齐备（缺了下面的断言会变成假绿）', () => {
    expect(existsSync(GEAR)).toBe(true)
    expect(existsSync(DROP)).toBe(true)
  })

  it('产出 720×960 且带音轨', () => {
    const r = ff(['-v', 'error', '-i', out, '-f', 'null', '-'])
    expect(r.ok).toBe(true)
    const p = spawnSync(process.env.FFPROBE_BIN ?? 'ffprobe',
      ['-v', 'error', '-show_entries', 'stream=codec_type,width,height', '-of', 'csv=p=0', out],
      { encoding: 'utf8' })
    expect(p.stdout).toContain('720,960')
    expect(p.stdout).toContain('audio')
  })

  // ★ 这条就是当初漏掉 zoompan 冻帧事故的那一条。
  // 八个时刻两两不同 —— 任何「画面定格」都过不了。
  it('画面全程在动：任意两个时刻之间画面都有实质变化', () => {
    // 原来用帧指纹判定,在有纹理画面上是假绿(x264 逐帧调 QP 让定格画面也给出不同指纹)。
    // 改用帧间平均绝对差,见 render/ffmpeg/testkit.ts。
    const m = minAdjacentChangedRatio(out, [0.5, 1.5, 3, 5, 7, 9, 10.5, 11.5])
    expect(m, `相邻采样之间画面几乎没变(画面定格): 最小变化像素占比=${m}`).toBeGreaterThan(STILL_RATIO)
  })

  // ★ 这条对应另一次事故：齿轮音本该铺在书封快闪段，却被写成从 0 秒盖在开场上。
  it('齿轮音落在快闪段，不在开场段', () => {
    const win = soundWindows(out)
    expect(win.length, '完全没检出声音，断言无意义').toBeGreaterThan(0)
    const first = win[0]
    // 起点应贴着开场结束（音头有渐起，给 0.3s 余量）；绝不能从 0 秒就开始响
    expect(first.start).toBeGreaterThan(OPEN_END - 0.15)
    expect(first.start).toBeLessThan(OPEN_END + 0.35)
  })

  it('水滴音在快闪结束处响起，且被截断不拖进正片', () => {
    const win = soundWindows(out)
    // 水滴那一段：起点贴着快闪结束点
    const drop = win.find((w) => w.start > FLASH_END - 0.1 && w.start < FLASH_END + 0.35)
    expect(drop, `没找到快闪结束处的水滴音，实测有声区间=${JSON.stringify(win)}`).toBeTruthy()
    // 草稿把 1.595s 的素材截到 0.53s；不截断会一直拖进正片第一句台词
    expect(drop!.end - drop!.start).toBeLessThan(0.8)
  })
})
