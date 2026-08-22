import { probeText } from '../runCmd'
import { promises as fs, existsSync } from 'fs'
import path from 'path'
import { prisma, transitionRender, enqueueGen, timeCaptionBeats, readFrameworkDefaults, resolveTemplateParamsRaw } from '@mixcut/db'
import { DATA_DIR, urlToAbs } from '../paths'
import type { BodyData, BodyOverlay } from '../../templates/booklist/bodyData'
import { renderBodyWithFfmpeg } from '../render/ffmpeg/renderPipeline'
import { parseTemplateParams } from '../../templates/booklist/templateParams'
import { resolveBooks } from './generateImage'

// worker/src/gen → up 2 = worker/ → templates/booklist（tsx 下 __dirname 于 CJS 可用）
const TEMPLATE_DIR = path.join(__dirname, '..', '..', 'templates', 'booklist')
const WIDTH = 720
const HEIGHT = 960

type Vars = Record<string, unknown>

/** 用 variables 的值替换字符串里的 {{key}} 占位符 */
function substitute(tpl: string, vars: Vars): string {
  return tpl.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_m, k: string) => {
    const v = vars[k.trim()]
    return v == null ? '' : String(v)
  })
}

/**
 * 由 framework.overlayTemplate（Json，如 {title_card, watermark} 或 {title, subtitle, watermark}）
 * + generationTask.variables 组装常驻层文案。overlayTemplate 各字符串值里的 {{key}} 用 variables 填充。
 */
export function buildOverlay(overlayTemplate: unknown, variables: unknown): BodyOverlay {
  const tpl = (overlayTemplate && typeof overlayTemplate === 'object' ? overlayTemplate : {}) as Record<string, unknown>
  const vars = (variables && typeof variables === 'object' ? variables : {}) as Vars
  const resolved: Record<string, string> = {}
  for (const [k, val] of Object.entries(tpl)) {
    if (typeof val === 'string') resolved[k] = substitute(val, vars)
  }
  return {
    title: resolved.title ?? resolved.title_card ?? '',
    subtitle: resolved.subtitle ?? '',
    watermark: resolved.watermark ?? '',
  }
}

interface TaskWithFramework {
  variables: unknown
  bodyTimings: unknown
  framework: { overlayTemplate: unknown }
}

interface SegmentRow {
  seqNo: number
  scriptText: string
  imageUrl: string | null
  bookTitle?: string | null
  bookAuthor?: string | null
  subtitleEn?: string | null
  captionBeats?: unknown
}

/** 框架绑定的 BGM 分组（overlayTemplate.__bgmFolder）：生成时从该分组随机配乐 */
export function readBgmFolder(overlayTemplate: unknown): string | null {
  const ot = overlayTemplate && typeof overlayTemplate === 'object' && !Array.isArray(overlayTemplate)
    ? (overlayTemplate as Record<string, unknown>) : {}
  const v = typeof ot.__bgmFolder === 'string' ? ot.__bgmFolder.trim() : ''
  return v || null
}

/**
 * 选定本条片子的 BGM。优先级：
 *   1. variables.__bgmId —— 运营在编辑页/工作台手选的这一条
 *   2. 框架绑定的 BGM 分组（__bgmFolder）—— 从分组里按 genTaskId 稳定随机挑一首
 *      （用户要的"框架的 BGM 分组随机匹配"；排在 __defaultBgmId 之前：
 *      分组是运营显式配置的意图，导入默认曲只是解析残留）
 *   3. 剪映导入框架的默认 BGM（__defaultBgmId，原工程同款）
 *   4. 全库随机兜底（对齐竞品：无指定则配乐，不留白）
 * 随机一律用 genTaskId 派生的稳定索引：同任务重跑不换曲（本仓禁 Math.random）。
 * 每一级都校验记录仍存在，避免陈旧 id 触发 FK 失败。
 */
export async function resolveBgmId(
  variables: unknown,
  overlayTemplate: unknown,
  genTaskId: string,
): Promise<string | null> {
  const vars = variables as { __bgmId?: string } | null
  if (vars && typeof vars === 'object' && vars.__bgmId) {
    const bgm = await prisma.bgmLibrary.findUnique({ where: { id: vars.__bgmId } })
    if (bgm) return bgm.id
  }
  const hashPick = (pool: { id: string }[]): string | null => {
    if (pool.length === 0) return null
    const idx = Array.from(genTaskId).reduce((a, c) => a + c.charCodeAt(0), 0) % pool.length
    return pool[idx].id
  }
  const folder = readBgmFolder(overlayTemplate)
  if (folder) {
    const pool = await prisma.bgmLibrary.findMany({
      where: { folder, fileUrl: { not: '' } }, select: { id: true }, orderBy: { id: 'asc' },
    })
    const picked = hashPick(pool)
    if (picked) return picked
    console.warn(`[gen] resolve-bgm: 框架绑定的分组「${folder}」里没有可用曲目，落到下一级`)
  }
  const defaultBgmId = readFrameworkDefaults(overlayTemplate).bgmId
  if (defaultBgmId) {
    const bgm = await prisma.bgmLibrary.findUnique({ where: { id: defaultBgmId } })
    if (bgm) return bgm.id
  }
  const pool = await prisma.bgmLibrary.findMany({ where: { fileUrl: { not: '' } }, select: { id: true }, orderBy: { id: 'asc' } })
  return hashPick(pool)
}

/** 组装 BodyData：segments 由 bodyTimings（按 seqNo）join generated_segments；images 1:1 */
export function buildBodyData(
  task: TaskWithFramework,
  segments: SegmentRow[],
  genTaskId: string,
): { data: BodyData; images: { seqNo: number; abs: string; rel: string }[] } {
  const timings = Array.isArray(task.bodyTimings)
    ? (task.bodyTimings as { seqNo: number; startMs: number; endMs: number }[])
    : []
  if (timings.length === 0) throw new Error('bodyTimings 为空，需先完成 align-captions')

  const timingBySeq = new Map(timings.map((t) => [t.seqNo, t]))
  const overlay = buildOverlay(task.framework.overlayTemplate, task.variables)

  const images: { seqNo: number; abs: string; rel: string }[] = []
  const bodySegments = []
  let imageIndex = 0
  for (const seg of [...segments].sort((a, b) => a.seqNo - b.seqNo)) {
    const t = timingBySeq.get(seg.seqNo)
    if (!t) throw new Error(`segment seqNo=${seg.seqNo} 无对应 bodyTiming`)
    if (!seg.imageUrl) throw new Error(`segment seqNo=${seg.seqNo} 缺少 imageUrl`)
    const nn = String(imageIndex + 1).padStart(2, '0')
    const rel = `media/${nn}.png`
    images.push({ seqNo: seg.seqNo, abs: urlToAbs(seg.imageUrl), rel })
    // 字幕节拍：本段口播短句在段时间窗内快速逐拍切换（图片保持）。缺省则回退整段单条字幕。
    // hidden 节拍（书名）不进画面：TTS 念、字幕不显示（顶部常驻标题已有《书名》）。
    // 过滤只在这一处做——DB 里保留完整节拍，重新配音时书名不丢。
    const rawBeats = Array.isArray(seg.captionBeats)
      ? (seg.captionBeats as { zh?: string; en?: string; startMs?: number; endMs?: number; hidden?: boolean }[]).filter(
          (b) => b && typeof b.zh === 'string' && b.zh.trim() && !b.hidden,
        )
      : []
    // generateTts 逐句配音已写入精确 startMs/endMs → 直接采用（字幕=真实音频时长，逐句对齐）；
    // 旧任务无精确时长时才回退按字数在段窗内均分。
    const hasExactBeats = rawBeats.length > 0 && rawBeats.every((b) => typeof b.startMs === 'number' && typeof b.endMs === 'number')
    const timedBeats = hasExactBeats
      ? rawBeats.map((b) => ({ zh: b.zh as string, en: b.en, startMs: b.startMs as number, endMs: b.endMs as number }))
      : rawBeats.length > 1
        ? timeCaptionBeats(rawBeats.map((b) => ({ zh: b.zh as string, en: b.en })), t.startMs, t.endMs)
        : []
    bodySegments.push({
      seqNo: seg.seqNo,
      startMs: t.startMs,
      endMs: t.endMs,
      subtitle: seg.scriptText,
      imageIndex,
      ...(seg.bookTitle ? { bookTitle: seg.bookTitle } : {}),
      ...(seg.bookAuthor ? { bookAuthor: seg.bookAuthor } : {}),
      ...(seg.subtitleEn ? { subtitleEn: seg.subtitleEn } : {}),
      ...(timedBeats.length ? { captionBeats: timedBeats } : {}),
    })
    imageIndex++
  }

  // 风格预设：框架可在 overlayTemplate.__style 指定；seed 用 genTaskId 保证同任务稳定。
  const ot = (task.framework.overlayTemplate && typeof task.framework.overlayTemplate === 'object'
    ? (task.framework.overlayTemplate as Record<string, unknown>)
    : {})
  const style = typeof ot.__style === 'string' ? ot.__style : undefined

  const data: BodyData = {
    size: { width: WIDTH, height: HEIGHT },
    overlay,
    images: images.map((i) => ({ src: i.rel })),
    segments: bodySegments,
    seed: genTaskId,
    ...(style ? { style } : {}),
  }

  // ★ 走 resolveTemplateParamsRaw：框架那份 + 本任务在工作台里改的那份（variables.__templateParams）。
  // 无覆盖时它原样返回框架那份，老任务零回归。
  const params = parseTemplateParams(resolveTemplateParamsRaw(task.framework.overlayTemplate, task.variables))
  if (params.mode === 'flash') {
    const books = resolveBooks(task.framework.overlayTemplate, task.variables)
    const flashCovers = books.map((b, i) => ({
      title: b.title, ...(b.author ? { author: b.author } : {}),
      coverSrc: `covers/${String(i + 1).padStart(2, '0')}.png`,
    }))
    // 书封文件加入待拷贝清单（渲染前 renderVisuals 会把 images[].abs→hf/rel）
    books.forEach((_b, i) => {
      const nn = String(i + 1).padStart(2, '0')
      images.push({ seqNo: 1000 + i, abs: path.join(DATA_DIR, 'gen', genTaskId, 'covers', `${nn}.png`), rel: `covers/${nn}.png` })
    })
    ;(data as BodyData).template = 'flash'
    ;(data as BodyData).templateParams = params
    ;(data as BodyData).flashCovers = flashCovers
    ;(data as BodyData).fonts = [
      { family: 'flash-title', url: 'fonts/title.ttf' },
      { family: 'subtitle', url: 'fonts/sub.otf' },
    ]
    // 开场图：generate-image 配了 __openImage 才会产出 open.png。
    // 存在才带上——不存在时渲染层回退正片第 1 张，老任务/未配置零回归。
    // 这里只声明，文件存不存在由 renderVisuals 拷贝时 best-effort 处理。
    const openAbs = path.join(DATA_DIR, 'gen', genTaskId, 'open.png')
    if (existsSync(openAbs)) {
      images.push({ seqNo: 2000, abs: openAbs, rel: 'media/open.png' })
      ;(data as BodyData).openImage = { src: 'media/open.png' }
    }
  }
  return { data, images }
}

async function probeDims(mp4Abs: string): Promise<{ width: number; height: number }> {
  const out = await probeText('ffprobe',
    ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0:s=x', mp4Abs])
  const [w, h] = out.split('x').map((n) => parseInt(n, 10))
  return { width: w, height: h }
}

export async function renderVisuals(genTaskId: string): Promise<void> {
  const task = await prisma.generationTask.findUniqueOrThrow({
    where: { id: genTaskId },
    include: { framework: true },
  })
  const segments = await prisma.generatedSegment.findMany({
    where: { generationTaskId: genTaskId },
    orderBy: { seqNo: 'asc' },
  })
  if (segments.length === 0) throw new Error(`generation_task ${genTaskId} 无 generated_segments`)

  const { data, images } = buildBodyData(task, segments, genTaskId)

  const bgmId = await resolveBgmId(task.variables, task.framework.overlayTemplate, genTaskId)

  // 本 job 创建 RenderTask
  const renderTask = await prisma.renderTask.create({
    data: { generationTaskId: genTaskId, status: 'VISUAL_RENDERING', bgmId },
  })

  try {
    // 准备工作目录 /data/gen/<id>/hf/
    const hfDir = path.join(DATA_DIR, 'gen', genTaskId, 'hf')
    const mediaDir = path.join(hfDir, 'media')
    await fs.rm(hfDir, { recursive: true, force: true })
    await fs.mkdir(mediaDir, { recursive: true })
    await fs.mkdir(path.join(hfDir, 'covers'), { recursive: true })

    // 拷字体目录：best-effort，缺失时不应中断渲染
    try {
      await fs.cp(path.join(TEMPLATE_DIR, 'fonts'), path.join(hfDir, 'fonts'), { recursive: true })
    } catch {
      // 忽略：字幕烧录用的是 worker 内置字体，这里只是给模板资源留位
    }

    // 拷各段图片到 media/<NN>.png
    for (const img of images) {
      await fs.copyFile(img.abs, path.join(hfDir, img.rel))
    }

    // 渲染：全片由 ffmpeg 出（开场碎裂见 render/ffmpeg/shatterMaps.ts）。
    // 产出 720×960、无声、全片长的 body.mp4，后面的 render-video
    // （混音/BGM/音效/loudnorm）消费它。
    const outAbs = path.join(hfDir, 'renders', 'body.mp4')
    // 模板级素材缓存（碎裂坐标表、水波纹位移图），跨任务复用，不要放进任务目录
    await renderBodyWithFfmpeg(hfDir, data, path.join(DATA_DIR, 'render-cache'))
    await verifyBody(outAbs, genTaskId)

    await transitionRender(renderTask.id, 'RENDERING')
    await enqueueGen('render-video', { renderTaskId: renderTask.id })
  } catch (err) {
    // 渲染失败：置 RenderTask FAILED 并抛出（handler 也会兜底，这里带上下文）
    await transitionRender(renderTask.id, 'FAILED', err instanceof Error ? err.message : String(err)).catch(() => {})
    throw err
  }
}

/** 产物校验：尺寸不对就不该往下走 */
async function verifyBody(outAbs: string, genTaskId: string): Promise<void> {
  await fs.access(outAbs) // 不存在则抛
  const dims = await probeDims(outAbs)
  if (dims.width !== WIDTH || dims.height !== HEIGHT) {
    throw new Error(`body.mp4 尺寸异常: ${dims.width}x${dims.height}（期望 ${WIDTH}x${HEIGHT}）`)
  }
  console.log(`[gen] render-visuals ${genTaskId}: body.mp4 ${dims.width}x${dims.height} ok`)
}
