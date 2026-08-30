// FFmpeg 渲染管线的编排层：把「渲开场 → 备水波纹素材 → 总装」三步串起来，
// 产出与 HyperFrames 完全同契约的 body.mp4（720×960、无声）。
//
// 放在这里而不是塞进 renderVisuals：renderVisuals 已经背着建 RenderTask、选 BGM、
// 拷素材一堆职责，再塞进来就没法读了。这里只做渲染，不碰数据库。

import { runCmd } from '../../runCmd'
import { promises as fs } from 'fs'
import path from 'path'
import type { BodyData } from '../../../templates/booklist/bodyData'
import { flashTimeline } from '../../../templates/booklist/templateParams'
import { fromBodyData } from './fromBodyData'
import { buildRenderFullPlan } from './renderFull'
import { buildRippleDisplaceArgs } from './ripple'
import { buildShatterMaps, buildShatterArgs, DEFAULT_GEOM, SHATTER_MAPS_VERSION } from './shatterMaps'
import { FONTS_DIR, usedBuiltinFontIds } from './fonts'
import { BUILTIN_FONTS } from '@mixcut/db'

const FPS = 30

async function run(bin: string, args: string[], input?: Buffer): Promise<{ ok: boolean; out: string }> {
  return runCmd(bin, args, { ...(input ? { input } : {}) })
}

/**
 * 预渲染开场碎裂的坐标映射表。
 *
 * **按参数缓存**，理由同水波纹：碎片的几何运动与配图无关，同模板的每条片子完全一样，
 * 只有贴图不同。算一次约 2.5 秒，之后每条片子零成本。
 *
 * 存成 ffv1 无损：原始 raw 三张共 223MB，ffv1 压到约 3MB，且实测解回来逐字节一致——
 * 坐标表**一个 bit 都不能错**，错一位碎片就会从画面另一头取色，所以不能用有损编码。
 */
async function ensureShatterMaps(
  cacheRoot: string, width: number, height: number, durationMs: number,
): Promise<{ xmapAbs: string; ymapAbs: string; bloomAbs: string; specAbs: string }> {
  // 键里带版本号：改了映射表的算法而键不变，服务器会继续吃旧缓存，
  // 表现是「部署完画面却没变」且没有任何报错
  const key = `v${SHATTER_MAPS_VERSION}-${width}x${height}@${FPS}-${Math.round(durationMs)}`
  const dir = path.join(cacheRoot, 'shatter', key)
  const out = {
    xmapAbs: path.join(dir, 'x.mkv'),
    ymapAbs: path.join(dir, 'y.mkv'),
    bloomAbs: path.join(dir, 'bloom.mkv'),
    specAbs: path.join(dir, 'spec.mkv'),
  }
  const done = path.join(dir, '.done')
  try {
    await fs.access(done)
    return out
  } catch {
    /* 未生成过，往下算 */
  }
  await fs.mkdir(dir, { recursive: true })
  const maps = buildShatterMaps({ width, height, fps: FPS, durationMs, ...DEFAULT_GEOM })
  const enc = async (buf: Buffer, pixFmt: string, dst: string) => {
    const r = await run('ffmpeg', [
      '-v', 'error',
      '-f', 'rawvideo', '-pix_fmt', pixFmt, '-s', `${width}x${height}`, '-r', String(FPS), '-i', 'pipe:0',
      '-c:v', 'ffv1', '-level', '3', '-y', dst,
    ], buf)
    if (!r.ok) throw new Error(`碎裂映射表编码失败(${path.basename(dst)}): ${r.out.slice(-500)}`)
  }
  await enc(maps.xmap, 'gray16le', out.xmapAbs)
  await enc(maps.ymap, 'gray16le', out.ymapAbs)
  await enc(maps.bloom, 'gray8', out.bloomAbs)
  await enc(maps.spec, 'gray8', out.specAbs)
  await fs.writeFile(done, key, 'utf8')
  return out
}

/**
 * 渲开场碎裂片段 —— 纯 ffmpeg，不再需要无头浏览器。
 *
 * 碎片必须带着**本条片子自己的图**，所以不能像水波纹那样把成片预渲染掉；
 * 但可以把「每个输出像素去源图哪取色」预渲染成坐标表（见 shatterMaps.ts），
 * 每条片子只做一次 remap 查表。这是 HyperFrames 在渲染链上的最后一处依赖。
 */
async function renderOpening(hfDir: string, data: BodyData, durationMs: number, cacheRoot: string): Promise<string> {
  const dir = path.join(hfDir, 'opening')
  await fs.mkdir(dir, { recursive: true })
  const { width, height } = data.size
  const maps = await ensureShatterMaps(cacheRoot, width, height, durationMs)
  // 开场图优先用它自己的那张（__openImage 配了才有）。
  // 缺省回退正片第 1 张——那是加独立开场槽位之前的行为，老框架零回归。
  const imgAbs = path.join(hfDir, data.openImage?.src ?? data.images[0]?.src ?? 'media/01.png')
  const outAbs = path.join(dir, 'open.mp4')
  const r = await run('ffmpeg', buildShatterArgs({
    imgAbs, width, height, fps: FPS, durationMs, ...maps, outAbs,
  }))
  if (!r.ok) throw new Error(`开场碎裂渲染失败: ${r.out.slice(-800)}`)
  await fs.access(outAbs)
  return outAbs
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
    const r = await run('ffmpeg', buildRippleDisplaceArgs(opts, axis, pattern))
    if (!r.ok) throw new Error(`水波纹位移图渲染失败(${axis}): ${r.out.slice(-500)}`)
  }
  await fs.writeFile(done, key, 'utf8')
  return { xmapAbs, ymapAbs }
}

/**
 * 建 per-task fontsdir：**只拷本条片子真正用到的字体文件**，不是整个内置字体目录。
 *
 * 为什么不能图省事整目录拷贝：见 fonts.ts usedBuiltinFontIds 的注释——只要某个
 * 同族名不同字重的字体文件躺在 fontsdir 里，ass.ts 写死的 Bold=1 就会让 libass
 * 选中真粗体字面，所有没被选中的框架也会无声变粗。fontsdir 里有什么文件，
 * 必须由「这条片子选了什么字体」决定，不能由「仓库里有什么字体」决定。
 *
 * 目前 TemplateParams.text 还没有 captionFontId/titleFontId/enFontId 字段
 * （下一批任务才加），所以 usedIds 参数缺省时只会拷默认字体一个文件——
 * 接口先留好，等字段落地后调用方直接把选中的 id 传进来即可。
 */
async function prepareFontsDir(hfDir: string, usedIds: (string | undefined)[] = []): Promise<string> {
  const dir = path.join(hfDir, 'fonts')
  await fs.mkdir(dir, { recursive: true })
  const ids = usedBuiltinFontIds(usedIds)
  for (const id of ids) {
    const entry = BUILTIN_FONTS.find((f) => f.id === id)
    if (!entry) continue // usedBuiltinFontIds 已经过滤过，这里只是防御
    await fs.copyFile(path.join(FONTS_DIR, entry.file), path.join(dir, entry.file))
  }
  return dir
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
    openingClipAbs = await renderOpening(hfDir, data, t.openEndMs, cacheRoot)
  }

  // 水波纹：只有草稿里提取到才备素材
  let ripple: { xmapAbs: string; ymapAbs: string } | undefined
  if (p?.effects?.ripple) {
    ripple = await ensureRippleMaps(cacheRoot, data.size.width, data.size.height, p.effects.ripple.durationMs)
  }

  const outAbs = path.join(hfDir, 'renders', 'body.mp4')
  await fs.mkdir(path.dirname(outAbs), { recursive: true })
  // per-task fontsdir：只装本条片子用到的字体（见 prepareFontsDir 的注释）
  const fontsDir = await prepareFontsDir(hfDir)
  const plan = buildRenderFullPlan(fromBodyData(data, {
    hfDir,
    ...(openingClipAbs ? { openingClipAbs } : {}),
    ...(ripple ? { ripple } : {}),
    assAbs: path.join(hfDir, 'subs.ass'),
    outAbs,
    fontsDir,
  }))
  await fs.writeFile(path.join(hfDir, 'subs.ass'), plan.assContent, 'utf8')

  const r = await run('ffmpeg', plan.args)
  if (!r.ok) throw new Error(`ffmpeg 总装失败: ${r.out.slice(-1000)}`)
  await fs.access(outAbs)
  return outAbs
}
