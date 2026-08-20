// FFmpeg 渲染管线的编排层：把「渲开场 → 备水波纹素材 → 总装」三步串起来，
// 产出与 HyperFrames 完全同契约的 body.mp4（720×960、无声）。
//
// 放在这里而不是塞进 renderVisuals：renderVisuals 已经背着建 RenderTask、选 BGM、
// 拷素材一堆职责，再塞进来就没法读了。这里只做渲染，不碰数据库。

import { spawnSync } from 'child_process'
import { promises as fs } from 'fs'
import path from 'path'
import type { BodyData } from '../../../templates/booklist/indexHtml'
import { openingIndexHtml } from '../../../templates/booklist/openingHtml'
import { selectPreset } from '../../../templates/booklist/theme'
import { flashTimeline } from '../../../templates/booklist/templateParams'
import { fromBodyData } from './fromBodyData'
import { buildRenderFullPlan } from './renderFull'
import { buildRippleDisplaceArgs } from './ripple'

const FPS = 30

function run(bin: string, args: string[], cwd?: string): { ok: boolean; out: string } {
  const r = spawnSync(bin, args, {
    encoding: 'utf8',
    ...(cwd ? { cwd } : {}),
    env: { ...process.env, HYPERFRAMES_BROWSER_PATH: process.env.HYPERFRAMES_BROWSER_PATH ?? '/usr/bin/chromium' },
  })
  return { ok: r.status === 0, out: `${r.stdout ?? ''}${r.stderr ?? ''}` }
}

/**
 * 渲开场碎裂片段（HyperFrames）。
 *
 * 为什么这一段不能也交给 ffmpeg：碎片必须**带着本条片子自己的图**。
 * 预渲染成固定素材行不通（每条片子的图都不同），用 ffmpeg 给 48 片各拉一条
 * crop→rotate→overlay 链理论可行但那是整个迁移里最不确定的一块，先不啃。
 * 它只占 2.16 秒，其余 90% 片长已经由 ffmpeg 承担。
 */
async function renderOpening(hfDir: string, data: BodyData, durationMs: number): Promise<string> {
  const dir = path.join(hfDir, 'opening')
  await fs.mkdir(dir, { recursive: true })
  // 开场用正片第 1 张图（与 HyperFrames 分支同一张，切换渲染器时开场画面不变）
  const imgRel = data.images[0]?.src ?? 'media/01.png'
  await fs.copyFile(path.join(hfDir, imgRel), path.join(dir, 'open.png'))
  await fs.copyFile(path.join(hfDir, 'gsap.min.js'), path.join(dir, 'gsap.min.js'))
  await fs.copyFile(path.join(hfDir, 'package.json'), path.join(dir, 'package.json'))
  await fs.writeFile(
    path.join(dir, 'index.html'),
    openingIndexHtml({
      imgSrc: 'open.png',
      width: data.size.width,
      height: data.size.height,
      durationMs,
      preset: selectPreset(data.style, data.seed ?? ''),
    }),
    'utf8',
  )
  const r = run('npx', ['--yes', 'hyperframes@0.7.33', 'render', '--quality', 'standard', '--output', 'renders/open.mp4'], dir)
  const out = path.join(dir, 'renders', 'open.mp4')
  if (!r.ok) throw new Error(`开场渲染失败 (hyperframes): ${r.out.slice(-800)}`)
  await fs.access(out)
  return out
}

/**
 * 预渲染水波纹位移图。
 *
 * **按参数缓存**：同一个模板的每条片子用的是同一组位移图（与文案配图无关）。
 * 不缓存的话每条片子白付 8 秒 geq —— 那正好是「装饰层预渲染」这个设计要避免的事。
 * 缓存键包含尺寸与时长：换模板/换画布就会重算。
 */
async function ensureRippleMaps(
  cacheRoot: string, width: number, height: number, durationMs: number,
): Promise<{ xmapAbs: string; ymapAbs: string }> {
  const key = `${width}x${height}@${FPS}-${Math.round(durationMs)}`
  const dir = path.join(cacheRoot, 'ripple', key)
  const xmapAbs = path.join(dir, 'x%03d.png')
  const ymapAbs = path.join(dir, 'y%03d.png')
  const done = path.join(dir, '.done')
  try {
    await fs.access(done)
    return { xmapAbs, ymapAbs }
  } catch {
    /* 未生成过，往下渲 */
  }
  await fs.mkdir(dir, { recursive: true })
  const opts = { width, height, fps: FPS, durationMs, rings: 3, outPattern: '' }
  for (const [axis, pattern] of [['x', xmapAbs], ['y', ymapAbs]] as const) {
    const r = run('ffmpeg', buildRippleDisplaceArgs(opts, axis, pattern))
    if (!r.ok) throw new Error(`水波纹位移图渲染失败(${axis}): ${r.out.slice(-500)}`)
  }
  await fs.writeFile(done, key, 'utf8')
  return { xmapAbs, ymapAbs }
}

/**
 * 用 FFmpeg 渲染 body.mp4。产出与 HyperFrames 分支同契约：720×960、无声、全片长。
 * @param cacheRoot 模板级素材缓存根目录（水波纹位移图存这里，跨任务复用）
 */
export async function renderBodyWithFfmpeg(
  hfDir: string, data: BodyData, cacheRoot: string,
): Promise<string> {
  const p = data.templateParams
  const segs = [...data.segments].sort((a, b) => a.startMs - b.startMs)
  const t = p ? flashTimeline(p, segs[0]?.endMs ?? 0, (data.flashCovers ?? []).length) : null

  // 开场：只有模板要求碎裂开场时才渲。不要则整片从快闪开始，第 0 段窗口由快闪铺满。
  let openingClipAbs: string | undefined
  if (p?.open.shatter && t && t.openEndMs > 0) {
    openingClipAbs = await renderOpening(hfDir, data, t.openEndMs)
  }

  // 水波纹：只有草稿里提取到才备素材
  let ripple: { xmapAbs: string; ymapAbs: string } | undefined
  if (p?.effects?.ripple) {
    ripple = await ensureRippleMaps(cacheRoot, data.size.width, data.size.height, p.effects.ripple.durationMs)
  }

  const outAbs = path.join(hfDir, 'renders', 'body.mp4')
  await fs.mkdir(path.dirname(outAbs), { recursive: true })
  const plan = buildRenderFullPlan(fromBodyData(data, {
    hfDir,
    ...(openingClipAbs ? { openingClipAbs } : {}),
    ...(ripple ? { ripple } : {}),
    assAbs: path.join(hfDir, 'subs.ass'),
    outAbs,
  }))
  await fs.writeFile(path.join(hfDir, 'subs.ass'), plan.assContent, 'utf8')

  const r = run('ffmpeg', plan.args)
  if (!r.ok) throw new Error(`ffmpeg 总装失败: ${r.out.slice(-1000)}`)
  await fs.access(outAbs)
  return outAbs
}
