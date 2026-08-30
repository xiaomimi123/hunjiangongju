// FFmpeg 渲染管线的编排层：把「渲开场 → 备水波纹素材 → 总装」三步串起来，
// 产出与 HyperFrames 完全同契约的 body.mp4（720×960、无声）。
//
// 放在这里而不是塞进 renderVisuals：renderVisuals 已经背着建 RenderTask、选 BGM、
// 拷素材一堆职责，再塞进来就没法读了。这里只做渲染——唯一碰数据库的地方是
// prepareFontsDir 查 CustomFont 表（自定义字体元数据），且查库能力可注入以便测试。

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
import { BUILTIN_FONTS, findBuiltinFont, prisma } from '@mixcut/db'
import { DATA_DIR } from '../../paths'

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

/** prepareFontsDir 查自定义字体表用的最小接口。真实实现是 prisma.customFont，
 * 测试可以喂一个假的进来——prepareFontsDir 不该因为「测试环境没数据库」而测不了。 */
export interface CustomFontLookup {
  findMany(args: { where: { id: { in: string[] } } }): Promise<
    { id: string; label: string; family: string; weight: number; fileName: string }[]
  >
}

export interface PreparedFontsDir {
  dir: string
  /** 自定义字体 id → {族名, 字重}，喂给 fromBodyData 的 io.fontFamilies */
  fontFamilies: Record<string, { family: string; weight: 400 | 700 }>
}

/**
 * 建 per-task fontsdir：**只拷本条片子真正用到的字体文件**，不是整个内置字体目录。
 *
 * 为什么不能图省事整目录拷贝：见 fonts.ts usedBuiltinFontIds 的注释——只要某个
 * 同族名不同字重的字体文件躺在 fontsdir 里，ass.ts 写死的 Bold=1 就会让 libass
 * 选中真粗体字面，所有没被选中的框架也会无声变粗。fontsdir 里有什么文件，
 * 必须由「这条片子选了什么字体」决定，不能由「仓库里有什么字体」决定。
 *
 * usedIds 由调用方从 templateParams.text 的 captionFontId/titleFontId/enFontId
 * 取出后传入；缺省（如测试直接调用）时只会拷默认字体一个文件。
 *
 * 认不出的 id（不在内置表里）当自定义字体处理：批量查一次 CustomFont 表
 * （不逐个查，避免每条片子 3 个字体字段打 3 次库），命中的从 data/fonts/ 拷进目录。
 *
 * ★ 磁盘缺文件的处理策略——响亮失败，不跳过：库里有记录但 data/fonts/ 下找不到
 * 文件，只可能是文件被误删/迁移丢失这类真正的异常状态，不是「运营没配」这种
 * 正常缺省。跟内置字体缺文件（本函数上半段，copyFile 无 try/catch）同一个态度：
 * 静默跳过会让运营选中的字体悄悄变成豆腐块，且日志毫无异常，排查成本极高——
 * 这正是本任务要堵的那类「界面上设了、成片没变化」的静默失效。
 */
export async function prepareFontsDir(
  hfDir: string,
  usedIds: (string | undefined)[] = [],
  customFont: CustomFontLookup = prisma.customFont,
): Promise<PreparedFontsDir> {
  const dir = path.join(hfDir, 'fonts')
  await fs.mkdir(dir, { recursive: true })
  const builtinIds = usedBuiltinFontIds(usedIds)
  for (const id of builtinIds) {
    const entry = BUILTIN_FONTS.find((f) => f.id === id)
    if (!entry) continue // usedBuiltinFontIds 已经过滤过，这里只是防御
    await fs.copyFile(path.join(FONTS_DIR, entry.file), path.join(dir, entry.file))
  }

  // 认不出的 id：既可能是自定义字体的 cuid，也可能是改过名/删过的脏配置——
  // 统一批量查一次库，查不到的行（脏配置）自然被 findMany 的结果过滤掉，不必单独处理。
  const unknownIds = [...new Set(usedIds.filter((id): id is string => !!id && !findBuiltinFont(id)))]
  const fontFamilies: Record<string, { family: string; weight: 400 | 700 }> = {}
  if (unknownIds.length > 0) {
    const rows = await customFont.findMany({ where: { id: { in: unknownIds } } })
    for (const row of rows) {
      // 响亮失败：copyFile 无 try/catch，文件缺失直接抛错（同内置字体的态度，见函数注释）
      await fs.copyFile(path.join(DATA_DIR, 'fonts', row.fileName), path.join(dir, row.fileName))
      fontFamilies[row.id] = { family: row.family, weight: row.weight === 700 ? 700 : 400 }
    }
  }
  return { dir, fontFamilies }
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
  // 运营在后台选的字体 id：来自 templateParams.text，喂给 prepareFontsDir 才会
  // 真的把字体文件拷进 fontsdir，否则渲染层回退默认字体、运营的选择静默失效。
  const fontIds = [p?.text?.captionFontId, p?.text?.titleFontId, p?.text?.enFontId]
  // per-task fontsdir：只装本条片子用到的字体（见 prepareFontsDir 的注释）。
  // 认不出的 id 会去查 CustomFont 表，命中的连同族名/字重一起回传——
  // 内置字体不必进 fontFamilies，fromBodyData 的 fontMeta 会自己查 findBuiltinFont。
  const { dir: fontsDir, fontFamilies } = await prepareFontsDir(hfDir, fontIds)
  const plan = buildRenderFullPlan(fromBodyData(data, {
    hfDir,
    ...(openingClipAbs ? { openingClipAbs } : {}),
    ...(ripple ? { ripple } : {}),
    assAbs: path.join(hfDir, 'subs.ass'),
    outAbs,
    fontsDir,
    fontFamilies,
  }))
  await fs.writeFile(path.join(hfDir, 'subs.ass'), plan.assContent, 'utf8')

  const r = await run('ffmpeg', plan.args)
  if (!r.ok) throw new Error(`ffmpeg 总装失败: ${r.out.slice(-1000)}`)
  await fs.access(outAbs)
  return outAbs
}
