import { spawnSync } from 'child_process'
import { promises as fs } from 'fs'
import path from 'path'
import { prisma, transitionRender, enqueueGen } from '@mixcut/db'
import { DATA_DIR, urlToAbs } from '../paths'
import { renderIndexHtml, type BodyData, type BodyOverlay } from '../../templates/booklist/indexHtml'

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
}

/** 组装 BodyData：segments 由 bodyTimings（按 seqNo）join generated_segments；images 1:1 */
export function buildBodyData(
  task: TaskWithFramework,
  segments: SegmentRow[],
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
    bodySegments.push({
      seqNo: seg.seqNo,
      startMs: t.startMs,
      endMs: t.endMs,
      subtitle: seg.scriptText,
      imageIndex,
      ...(seg.bookTitle ? { bookTitle: seg.bookTitle } : {}),
      ...(seg.bookAuthor ? { bookAuthor: seg.bookAuthor } : {}),
      ...(seg.subtitleEn ? { subtitleEn: seg.subtitleEn } : {}),
    })
    imageIndex++
  }

  const data: BodyData = {
    size: { width: WIDTH, height: HEIGHT },
    overlay,
    images: images.map((i) => ({ src: i.rel })),
    segments: bodySegments,
  }
  return { data, images }
}

function probeDims(mp4Abs: string): { width: number; height: number } {
  const r = spawnSync(
    'ffprobe',
    ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0:s=x', mp4Abs],
    { encoding: 'utf8' },
  )
  const [w, h] = (r.stdout ?? '').trim().split('x').map((n) => parseInt(n, 10))
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

  const { data, images } = buildBodyData(task, segments)

  // 换 BGM：编辑页把选中的 bgmId 存在 variables.__bgmId，此处取出写入 RenderTask.bgmId
  // （render-video 会据此混入 BGM）。校验 bgm 仍存在，避免陈旧 id 触发 FK 失败。
  const vars = task.variables as { __bgmId?: string } | null
  let bgmId: string | null = null
  if (vars && typeof vars === 'object' && vars.__bgmId) {
    const bgm = await prisma.bgmLibrary.findUnique({ where: { id: vars.__bgmId } })
    bgmId = bgm?.id ?? null
  }

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

    // 拷模板 package.json
    await fs.copyFile(path.join(TEMPLATE_DIR, 'package.json'), path.join(hfDir, 'package.json'))

    // 拷本地化的 GSAP（index.html 以相对路径 gsap.min.js 引用），离线/CN 主机可用，
    // 避免渲染时依赖外网 CDN 失败 → 静默产出无动画视频。
    await fs.copyFile(path.join(TEMPLATE_DIR, 'gsap.min.js'), path.join(hfDir, 'gsap.min.js'))

    // 拷各段图片到 media/<NN>.png
    for (const img of images) {
      await fs.copyFile(img.abs, path.join(hfDir, img.rel))
    }

    // 写 codegen index.html
    await fs.writeFile(path.join(hfDir, 'index.html'), renderIndexHtml(data), 'utf8')

    // 渲染（视频无音频，720×960）
    const outRel = path.join('renders', 'body.mp4')
    // hyperframes 需要本机 Chromium：ARM64/离线环境无法自动装 headless shell，
    // 依赖 worker 镜像预装的 chromium（默认 /usr/bin/chromium），可用 HYPERFRAMES_BROWSER_PATH 覆盖。
    const r = spawnSync(
      'npx',
      ['--yes', 'hyperframes@0.7.33', 'render', '--quality', 'standard', '--output', outRel],
      {
        cwd: hfDir,
        encoding: 'utf8',
        stdio: 'pipe',
        env: { ...process.env, HYPERFRAMES_BROWSER_PATH: process.env.HYPERFRAMES_BROWSER_PATH ?? '/usr/bin/chromium' },
      },
    )
    if (r.status !== 0) {
      throw new Error(`hyperframes render 失败 (code ${r.status}): ${(r.stderr ?? r.stdout ?? '').slice(-800)}`)
    }

    const outAbs = path.join(hfDir, outRel)
    await fs.access(outAbs) // 不存在则抛
    const dims = probeDims(outAbs)
    if (dims.width !== WIDTH || dims.height !== HEIGHT) {
      throw new Error(`body.mp4 尺寸异常: ${dims.width}x${dims.height}（期望 ${WIDTH}x${HEIGHT}）`)
    }
    console.log(`[gen] render-visuals ${genTaskId}: body.mp4 ${dims.width}x${dims.height} ok`)

    await transitionRender(renderTask.id, 'RENDERING')
    await enqueueGen('render-video', { renderTaskId: renderTask.id })
  } catch (err) {
    // 渲染失败：置 RenderTask FAILED 并抛出（handler 也会兜底，这里带上下文）
    await transitionRender(renderTask.id, 'FAILED', err instanceof Error ? err.message : String(err)).catch(() => {})
    throw err
  }
}
