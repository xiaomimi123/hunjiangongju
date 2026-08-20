// 接线层的真渲验收：喂一份真实形状的 BodyData，跑完「渲开场 → 备水波纹 → 总装」，
// 断言产出的 body.mp4 与 HyperFrames 分支同契约（720×960、无声、全片长）。
//
// 前面每个模块都单独验过了，但**接线本身没被验过**：hfDir 里的相对路径展开、
// 开场片段的时长与快闪起点对齐、水波纹缓存命中、ffmpeg 参数拼装——
// 这些只有把整条链真跑一遍才看得见。

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { spawnSync } from 'child_process'
import { mkdtempSync, rmSync, mkdirSync, existsSync, promises as fsp } from 'fs'
import os from 'os'
import path from 'path'
import { renderBodyWithFfmpeg } from './renderPipeline'
import { parseTemplateParams } from '../../../templates/booklist/templateParams'
import type { BodyData } from '../../../templates/booklist/bodyData'
import { minAdjacentChangedRatio, darkRatio } from './testkit'

const FFMPEG = process.env.FFMPEG_BIN ?? 'ffmpeg'
const d = process.env.RENDER_E2E === '1' ? describe : describe.skip
const W = 720
const H = 960

function ff(args: string[]): { ok: boolean; out: string } {
  const r = spawnSync(FFMPEG, args, { encoding: 'utf8' })
  return { ok: r.status === 0, out: `${r.stdout ?? ''}${r.stderr ?? ''}` }
}

d('真渲验收 —— FFmpeg 渲染管线接线', () => {
  let hfDir = ''
  let cacheRoot = ''
  let outAbs = ''

  const FLASH_END = 4000
  const B = (t: number) => FLASH_END + t

  const data = (): BodyData => ({
    size: { width: W, height: H },
    overlay: { title: '', subtitle: '', watermark: '@读书号' },
    images: [{ src: 'media/01.png' }, { src: 'media/02.png' }, { src: 'media/03.png' }],
    seed: 'task-e2e',
    template: 'flash',
    // 开场碎裂现在是纯 ffmpeg（坐标表 + remap），不再需要 Chromium，
    // 所以这里可以按真实模板打开它——接线连同碎裂一起验。
    templateParams: parseTemplateParams({
      mode: 'flash',
      open: { durationMs: 2159, shatter: true },
      transition: { type: 'dissolve', durationMs: 400, bodyCycle: [{ renderType: 'crossfade', durationMs: 500 }] },
      motion: { moves: [], keyframes: [{ scaleFrom: 1, scaleTo: 1.108 }] },
      effects: { ripple: { offsetMs: 7, durationMs: 458 } },
    }),
    flashCovers: [
      { title: '活着', author: '余华', coverSrc: 'covers/01.png' },
      { title: '兄弟', author: '余华', coverSrc: 'covers/02.png' },
    ],
    segments: [
      { seqNo: 1, startMs: 0, endMs: FLASH_END, subtitle: '今天分享的是', imageIndex: 0 },
      { seqNo: 2, startMs: B(0), endMs: B(4000), subtitle: '第一句', imageIndex: 1,
        bookTitle: '活着', bookAuthor: '余华',
        captionBeats: [{ zh: '如果你总困在过往的遗憾里', startMs: B(300), endMs: B(3700) }] },
      { seqNo: 3, startMs: B(4000), endMs: B(8000), subtitle: '第二句', imageIndex: 2,
        bookTitle: '活着', bookAuthor: '余华',
        captionBeats: [{ zh: '这本书会给你一个出口', startMs: B(4300), endMs: B(7700) }] },
    ],
  })

  beforeAll(async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'mixcut-pipe-'))
    hfDir = path.join(root, 'hf')
    cacheRoot = path.join(root, 'cache')
    mkdirSync(path.join(hfDir, 'media'), { recursive: true })
    mkdirSync(path.join(hfDir, 'covers'), { recursive: true })
    // 亮度阶梯分明的素材：哪一段在播用亮度就判得出来
    const mk = (rel: string, b: number) => {
      const r = ff(['-v', 'error', '-f', 'lavfi', '-i', `testsrc=size=${W * 2}x${H * 2}:rate=1:duration=1`,
        '-vf', `eq=brightness=${b}`, '-frames:v', '1', '-y', path.join(hfDir, rel)])
      if (!r.ok) throw new Error(`造图失败 ${rel}: ${r.out.slice(-300)}`)
    }
    mk('media/01.png', -0.1); mk('media/02.png', 0.0); mk('media/03.png', 0.25)
    mk('covers/01.png', -0.45); mk('covers/02.png', -0.4)
    outAbs = await renderBodyWithFfmpeg(hfDir, data(), cacheRoot)
  }, 180_000)

  afterAll(() => {
    if (hfDir) rmSync(path.dirname(hfDir), { recursive: true, force: true })
  })

  it('产出 720×960、无音轨（与 HyperFrames 分支同契约）', () => {
    const p = spawnSync(process.env.FFPROBE_BIN ?? 'ffprobe',
      ['-v', 'error', '-show_entries', 'stream=codec_type,width,height', '-of', 'csv=p=0', outAbs],
      { encoding: 'utf8' })
    expect(p.stdout).toContain('720,960')
    expect(p.stdout).not.toContain('audio')
  })

  // 快闪 4s + 正片 8s，两次叠化各吃 500ms（只有正片内部那一处边界）
  it('总时长 = 快闪窗口 + 正片，扣掉叠化', () => {
    const p = spawnSync(process.env.FFPROBE_BIN ?? 'ffprobe',
      ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', outAbs], { encoding: 'utf8' })
    expect(Math.abs(parseFloat(p.stdout) - 11.5)).toBeLessThan(0.2)
  })

  it('ASS 与 body.mp4 都落在 hf 目录里（后续步骤按约定路径取）', () => {
    expect(existsSync(path.join(hfDir, 'subs.ass'))).toBe(true)
    expect(outAbs).toBe(path.join(hfDir, 'renders', 'body.mp4'))
  })

  it('正片全程在动（运镜经过接线后仍生效）', () => {
    const m = minAdjacentChangedRatio(outAbs, [4.5, 6, 7.5, 9, 10.5])
    expect(m, `正片有时段定格: ${m}`).toBeGreaterThan(0.02)
  })

  // ★ 开场碎裂：碎片没飞到的地方是 remap 的 fill 黑，所以「开头近乎满屏黑、
  // 落位后回到素材自身的黑区水平」就是碎裂真的发生过的证据。
  //
  // 两个不能想当然的地方：
  //
  // 1. 不能断言「落位后几乎无黑」。实测落位后是 0.203，而那正是这套素材**自身**的
  //    黑区基线——关掉碎裂跑同一条链，全程恒为 0.203。把 0.203 当成"没拼合"是误判素材。
  // 2. 也不能断言「逐段单调收窄」。加了裂纹辉光之后实测 0.999→0.723→0.155→0.201：
  //    中段比落位后还低，因为辉光把暗像素提亮了。单调是旧版本才成立的巧合，不是性质。
  //
  // 真正的判别特征只有一条：**开头近乎全黑**。碎裂关掉时那一点是 0.203，一验就红。
  it('开场是碎裂拼合：黑区从近乎满屏收到素材基线', () => {
    const at = [0.1, 0.6, 1.2, 1.9].map((t) => darkRatio(outAbs, t))
    const shown = at.map((v) => v.toFixed(3)).join(' → ')
    expect(at[0], `开头不够黑(${shown})，碎片一上来就铺满了`).toBeGreaterThan(0.8)
    expect(at[1], `画面迟迟没被填进来(${shown})`).toBeLessThan(at[0] * 0.85)
    expect(at[3], `落位后黑区没收回基线(${shown})`).toBeLessThan(at[0] * 0.35)
  })

  // ★ 水波纹位移图按参数缓存：同模板的每条片子共用，不该逐条重渲 8 秒 geq
  it('水波纹位移图落在模板级缓存里，且带完成标记', async () => {
    const dir = path.join(cacheRoot, 'ripple', `${W}x${H}@30-458`)
    expect(existsSync(path.join(dir, '.done')), '缺完成标记，缓存下次会失效').toBe(true)
    const files = await fsp.readdir(dir)
    expect(files.filter((f) => f.startsWith('x')).length).toBeGreaterThan(10)
    expect(files.filter((f) => f.startsWith('y')).length).toBeGreaterThan(10)
  })

  // 碎裂坐标表同理按模板缓存：算一次约 2.5 秒，不该每条片子重算
  it('碎裂坐标表落在模板级缓存里，三张表俱全', async () => {
    const dir = path.join(cacheRoot, 'shatter', `v4-${W}x${H}@30-2159`)
    expect(existsSync(path.join(dir, '.done')), '缺完成标记，缓存下次会失效').toBe(true)
    for (const f of ['x.mkv', 'y.mkv', 'bloom.mkv']) {
      expect(existsSync(path.join(dir, f)), `缺 ${f}`).toBe(true)
    }
  })

  it('缓存命中时不重渲（第二次调用不改动缓存目录的 mtime）', async () => {
    const marks = [
      path.join(cacheRoot, 'ripple', `${W}x${H}@30-458`, '.done'),
      path.join(cacheRoot, 'shatter', `v4-${W}x${H}@30-2159`, '.done'),
    ]
    const before = await Promise.all(marks.map(async (m) => (await fsp.stat(m)).mtimeMs))
    await renderBodyWithFfmpeg(hfDir, data(), cacheRoot)
    for (let i = 0; i < marks.length; i++) {
      expect((await fsp.stat(marks[i])).mtimeMs, `${marks[i]} 被重写了，说明没命中`).toBe(before[i])
    }
  }, 180_000)
})
