// 真音频验收 —— BGM 选片段与淡入淡出。
//
// 为什么必须真跑：滤镜串拼对了不代表声音对。三个典型的"参数没错、听感全错"：
//   1. atrim 之后忘了 asetpts=PTS-STARTPTS —— afade 按绝对时间定位，整段落在片子之外，
//      听感是"淡入压根没生效"，而 ffmpeg 一句警告都不会给。
//   2. 淡入淡出窗口相加超过片长 —— 两个 afade 互相压住，中段音量被吃掉，
//      听起来像 BGM 整体变轻了。
//   3. atrim 起点写成 0:durSec 而不是 start:start+durSec —— 永远从曲子开头取，
//      "选副歌"这个功能整个失效，但成片照样能出。
// 这三个从波形上一量就现形，从命令行字符串上看不出来。

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { spawnSync } from 'child_process'
import { mkdtempSync, rmSync } from 'fs'
import os from 'os'
import path from 'path'
import { buildFfmpegArgs } from './renderVideo'

const FFMPEG = process.env.FFMPEG_BIN ?? 'ffmpeg'
const d = process.env.RENDER_E2E === '1' ? describe : describe.skip

/** 某个时间窗内的 RMS 音量。淡入淡出、静音、音量变化都靠它判。 */
function rms(mp4: string, fromSec: number, durSec: number): number {
  const r = spawnSync(FFMPEG,
    ['-v', 'error', '-ss', String(fromSec), '-t', String(durSec), '-i', mp4,
      '-f', 's16le', '-acodec', 'pcm_s16le', '-ar', '48000', '-ac', '1', '-'],
    { encoding: 'buffer', maxBuffer: 64 * 1024 * 1024 })
  const b = r.stdout as unknown as Buffer
  if (!b || b.length < 4) throw new Error('取 PCM 失败')
  let sum = 0
  for (let i = 0; i + 1 < b.length; i += 2) sum += b.readInt16LE(i) ** 2
  return Math.sqrt(sum / (b.length / 2))
}

/** 某个时间窗内的主频（过零率折算）。用来分辨"取的是曲子的哪一段"。 */
function zcr(mp4: string, fromSec: number, durSec: number): number {
  const r = spawnSync(FFMPEG,
    ['-v', 'error', '-ss', String(fromSec), '-t', String(durSec), '-i', mp4,
      '-f', 's16le', '-acodec', 'pcm_s16le', '-ar', '48000', '-ac', '1', '-'],
    { encoding: 'buffer', maxBuffer: 64 * 1024 * 1024 })
  const b = r.stdout as unknown as Buffer
  let cross = 0
  let prev = b.readInt16LE(0)
  for (let i = 2; i + 1 < b.length; i += 2) {
    const v = b.readInt16LE(i)
    if ((prev < 0 && v >= 0) || (prev >= 0 && v < 0)) cross++
    prev = v
  }
  return cross / (b.length / 2 / 48000)
}

d('真音频验收 —— BGM 选片段与淡入淡出', () => {
  let dir = ''
  let bodyAbs = ''
  let voiceAbs = ''
  let bgmAbs = ''
  const DUR = 6

  function run(extra: Partial<Parameters<typeof buildFfmpegArgs>[0]>, name: string): string {
    const outAbs = path.join(dir, name)
    const args = buildFfmpegArgs({
      bodyAbs, audioAbs: voiceAbs, bgmAbs, durSec: DUR, outAbs, bgmVolume: 1.0, ...extra,
    })
    const r = spawnSync(FFMPEG, args, { encoding: 'utf8' })
    if (r.status !== 0) throw new Error(`混音失败: ${(r.stderr ?? '').slice(-600)}`)
    return outAbs
  }

  beforeAll(() => {
    dir = mkdtempSync(path.join(os.tmpdir(), 'mixcut-bgm-'))
    bodyAbs = path.join(dir, 'body.mp4')
    voiceAbs = path.join(dir, 'voice.wav')
    bgmAbs = path.join(dir, 'bgm.wav')
    const sh = (args: string[], what: string) => {
      const r = spawnSync(FFMPEG, args, { encoding: 'utf8' })
      if (r.status !== 0) throw new Error(`造${what}失败: ${(r.stderr ?? '').slice(-400)}`)
    }
    sh(['-v', 'error', '-f', 'lavfi', '-i', `color=c=gray:s=720x960:r=30:d=${DUR}`,
      '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-y', bodyAbs], 'body')
    // 人声轨给极小音量，免得盖过 BGM 影响测量
    sh(['-v', 'error', '-f', 'lavfi', '-i', `sine=frequency=200:duration=${DUR}:sample_rate=48000`,
      '-af', 'volume=0.02', '-ac', '1', '-y', voiceAbs], '人声')
    // ★ BGM 造成"前 5 秒 300Hz、后 5 秒 1200Hz"的两段，这样一量主频就知道取的是哪一段
    sh(['-v', 'error',
      '-f', 'lavfi', '-i', 'sine=frequency=300:duration=5:sample_rate=48000',
      '-f', 'lavfi', '-i', 'sine=frequency=1200:duration=5:sample_rate=48000',
      '-filter_complex', '[0:a][1:a]concat=n=2:v=0:a=1[a]', '-map', '[a]', '-ac', '1', '-y', bgmAbs], 'BGM')
  }, 180_000)

  afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }) })

  // ★ 选片段：从第 5 秒起取，应该听到的是**后半段**（1200Hz），不是曲子开头（300Hz）
  it('bgmStartMs 生效：取到的是曲子的指定片段，不是开头', () => {
    const head = run({}, 'head.mp4')
    const tail = run({ bgmStartMs: 5000 }, 'tail.mp4')
    const fHead = zcr(head, 1, 2)
    const fTail = zcr(tail, 1, 2)
    expect(fTail / fHead, `没取到指定片段: 开头段 ${fHead.toFixed(0)} vs 指定段 ${fTail.toFixed(0)} 次/秒`)
      .toBeGreaterThan(2)
  })

  it('bgmFadeInMs 生效：开头明显轻于中段', () => {
    const out = run({ bgmFadeInMs: 2000 }, 'fadein.mp4')
    const head = rms(out, 0, 0.4)
    const mid = rms(out, 3, 0.8)
    expect(head / mid, `淡入没生效: 开头 ${head.toFixed(0)} vs 中段 ${mid.toFixed(0)}`).toBeLessThan(0.5)
  })

  // ★ 选片段 + 淡入**同时用**时才测得到 asetpts。
  // 只设淡入不设起点的话，atrim 起点本来就是 0、PTS 本来就从 0 开始，
  // asetpts 是个空操作——删掉它那条测试照样绿（第一版就是这么假绿的）。
  // 起点非 0 时若忘了 asetpts，afade 的 st=0 会落在片子之外，淡入整个失效。
  it('选片段 + 淡入同时用：淡入仍从片子开头起算（asetpts 回零）', () => {
    const out = run({ bgmStartMs: 5000, bgmFadeInMs: 2000 }, 'startfade.mp4')
    const head = rms(out, 0, 0.4)
    const mid = rms(out, 3, 0.8)
    expect(head / mid, `选了片段之后淡入失效: 开头 ${head.toFixed(0)} vs 中段 ${mid.toFixed(0)}`).toBeLessThan(0.5)
  })

  it('bgmFadeOutMs 生效：结尾明显轻于中段', () => {
    const out = run({ bgmFadeOutMs: 2000 }, 'fadeout.mp4')
    const mid = rms(out, 2.5, 0.8)
    const tail = rms(out, DUR - 0.35, 0.3)
    expect(tail / mid, `淡出没生效: 中段 ${mid.toFixed(0)} vs 结尾 ${tail.toFixed(0)}`).toBeLessThan(0.5)
  })

  // ★ 零回归红线：三个参数缺省时，滤镜串必须与加这个功能之前一致
  it('三个参数缺省时不产生 atrim 偏移与 afade', () => {
    const args = buildFfmpegArgs({ bodyAbs, audioAbs: voiceAbs, bgmAbs, durSec: DUR, outAbs: '/tmp/x.mp4', bgmVolume: 0.5 })
    const fc = args[args.indexOf('-filter_complex') + 1]
    expect(fc).toContain('atrim=0.000:6.000')
    expect(fc, '缺省时不该出现淡化').not.toContain('afade')
  })

  // ★ 淡入淡出之和超过片长时，两个 afade 会互相压住，把本该满音量的部分也吃掉。
  //
  // 判据必须落在**同一个文件内部**。第一版拿「夹紧版」和「只淡入版」比中段音量，
  // 恒绿——因为混音链末端有 loudnorm=I=-14，**每个输出文件各自被归一化到同一响度**，
  // 跨文件比音量等于什么都没比。（第一版更早还只验了个 isFinite，那更是白写。）
  //
  // 同一文件内的判据：夹紧后 fadeOut 被夹到 1s（只影响最后 1 秒），
  // 所以第 4.6 秒处应当已接近满音量、明显**高于**第 2.6 秒（淡入还没走完）。
  // 不夹紧的话淡出从第 1 秒就开始，第 4.6 秒反而比第 2.6 秒更轻——高低关系直接反转。
  it('淡入淡出之和超过片长时被夹住，中段不被二次压低', () => {
    const out = run({ bgmFadeInMs: 5000, bgmFadeOutMs: 5000 }, 'clamp.mp4')
    const late = rms(out, 4.6, 0.3)
    const early = rms(out, 2.6, 0.3)
    expect(late / early, `淡出没被夹住，中后段被二次压低: 2.6s=${early.toFixed(0)} 4.6s=${late.toFixed(0)}`)
      .toBeGreaterThan(1.2)
  })
})
