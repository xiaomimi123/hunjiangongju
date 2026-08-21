// 真音频验收 —— 配音变速把超长段压回草稿槽位。
//
// 为什么必须真跑：compressTo 的**全部**理由是「atempo 只动语速、不动音高」。
// 单测只能证明命令行参数拼对了；换成 asetrate（改采样率的那种变速）参数一样能拼对、
// 时长也一样会变短，但声音会被捏尖——那正是这套代码原先「只补不压」要避开的问题。
// 所以这里必须从波形上量音高。

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { spawnSync } from 'child_process'
import { mkdtempSync, rmSync, copyFileSync } from 'fs'
import os from 'os'
import path from 'path'
import { compressTo } from './generateTts'

const FFMPEG = process.env.FFMPEG_BIN ?? 'ffmpeg'
const d = process.env.RENDER_E2E === '1' ? describe : describe.skip

function durationMs(wav: string): number {
  const r = spawnSync(process.env.FFPROBE_BIN ?? 'ffprobe',
    ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', wav], { encoding: 'utf8' })
  return parseFloat(r.stdout) * 1000
}

/**
 * 过零率（每秒穿过零点的次数）—— 纯音的过零率正比于频率（440Hz 正弦 ≈ 880 次/秒）。
 * 音高变了它就变，音高没变它就不变。比跑 FFT 简单得多，对纯音足够精确。
 */
function zeroCrossRate(wav: string): number {
  const r = spawnSync(FFMPEG,
    ['-v', 'error', '-i', wav, '-f', 's16le', '-acodec', 'pcm_s16le', '-ar', '48000', '-ac', '1', '-'],
    { encoding: 'buffer', maxBuffer: 64 * 1024 * 1024 })
  const buf = r.stdout as unknown as Buffer
  if (!buf || buf.length < 4) throw new Error('读取 PCM 失败')
  let crossings = 0
  let prev = buf.readInt16LE(0)
  for (let i = 2; i + 1 < buf.length; i += 2) {
    const v = buf.readInt16LE(i)
    if ((prev < 0 && v >= 0) || (prev >= 0 && v < 0)) crossings++
    prev = v
  }
  return crossings / (buf.length / 2 / 48000)
}

d('真音频验收 —— 配音变速压回槽位', () => {
  let dir = ''
  let srcTone = ''
  const SRC_MS = 3000

  beforeAll(() => {
    dir = mkdtempSync(path.join(os.tmpdir(), 'mixcut-tempo-'))
    srcTone = path.join(dir, 'tone.wav')
    const r = spawnSync(FFMPEG, ['-v', 'error', '-f', 'lavfi',
      '-i', `sine=frequency=440:duration=${SRC_MS / 1000}:sample_rate=48000`, '-ac', '1', '-y', srcTone],
      { encoding: 'utf8' })
    if (r.status !== 0) throw new Error(`造测试音失败: ${r.stderr}`)
  })

  afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }) })

  it('压到目标时长（3000ms → 2500ms）', async () => {
    const f = path.join(dir, 'a.wav')
    copyFileSync(srcTone, f)
    const used = await compressTo(f, SRC_MS, 2500, 1.25)
    expect(used).toBeCloseTo(1.2, 2)
    expect(Math.abs(durationMs(f) - 2500), `压后时长 ${durationMs(f)}ms`).toBeLessThan(60)
  })

  // ★ 这条是选 atempo 而不是 asetrate 的唯一理由，也是这组测试的核心。
  // 换成改采样率的变速，时长照样对，但过零率会跟着变速倍数一起涨。
  it('音高不变（过零率不随变速改变）', async () => {
    const f = path.join(dir, 'b.wav')
    copyFileSync(srcTone, f)
    const before = zeroCrossRate(f)
    await compressTo(f, SRC_MS, 2400, 1.25)
    const after = zeroCrossRate(f)
    expect(before).toBeGreaterThan(700) // 440Hz 正弦 ≈ 880 次/秒，先确认量对了东西
    expect(Math.abs(after / before - 1), `音高变了: ${before.toFixed(0)} → ${after.toFixed(0)} 次/秒`)
      .toBeLessThan(0.05)
  })

  it('变速倍数封顶（要 2× 但上限 1.25× → 只压到 1.25×）', async () => {
    const f = path.join(dir, 'c.wav')
    copyFileSync(srcTone, f)
    const used = await compressTo(f, SRC_MS, 1500, 1.25)
    expect(used).toBe(1.25)
    expect(durationMs(f), '压过头了，封顶没生效').toBeGreaterThan(2300)
  })

  // 只压不拉：配音比槽位短时该走补静音那条路，不该在这里被拉长
  it('已经短于目标 → 不动文件，返回 1', async () => {
    const f = path.join(dir, 'd.wav')
    copyFileSync(srcTone, f)
    const used = await compressTo(f, SRC_MS, 5000, 1.25)
    expect(used).toBe(1)
    expect(Math.abs(durationMs(f) - SRC_MS)).toBeLessThan(30)
  })
})
