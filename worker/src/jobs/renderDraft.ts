import path from 'path'
import fs from 'fs/promises'
import { prisma, transitionTask, estimateDurationMs, buildSrt, DIMS } from '@mixcut/db'
import { DATA_DIR, urlToAbs } from '../paths'
import { normalizeSegment, concatSegments, burnSubtitles } from '../ffmpeg'

export async function renderDraft(taskId: string): Promise<void> {
  const task = await prisma.task.findUniqueOrThrow({
    where: { id: taskId },
    include: {
      segments: { orderBy: { orderNo: 'asc' }, include: { material: true } },
    },
  })
  if (task.status !== 'RENDERING') throw new Error(`状态 ${task.status} 不能渲染`)
  const dims = DIMS[task.aspectRatio as '9:16' | '16:9']
  if (!dims) throw new Error(`未知输出规格 ${task.aspectRatio}`)

  // 1. 重算时间轴并写回
  let cursor = 0
  const timeline: { text: string; startMs: number; endMs: number }[] = []
  for (const seg of task.segments) {
    if (!seg.material) throw new Error(`分镜段 ${seg.orderNo} 缺少素材`)
    const text = seg.subtitleText ?? ''
    const dur = seg.endMs && seg.endMs > seg.startMs ? seg.endMs - seg.startMs : estimateDurationMs(text)
    const startMs = cursor
    const endMs = cursor + dur
    cursor = endMs
    timeline.push({ text, startMs, endMs })
    await prisma.taskSegment.update({ where: { id: seg.id }, data: { startMs, endMs } })
  }

  // 2. 产物目录 + SRT
  const outDir = path.join(DATA_DIR, 'exports', taskId)
  await fs.mkdir(outDir, { recursive: true })
  const srtPath = path.join(outDir, 'subtitle.srt')
  await fs.writeFile(srtPath, buildSrt(timeline))

  // 3. 逐段归一化 → 拼接 → 烧字幕
  const segFiles: string[] = []
  for (const [i, seg] of task.segments.entries()) {
    const out = path.join(outDir, `seg-${i + 1}.mp4`)
    await normalizeSegment({
      input: urlToAbs(seg.material!.fileUrl),
      out,
      durationMs: timeline[i].endMs - timeline[i].startMs,
      w: dims.w,
      h: dims.h,
      isImage: seg.material!.kind === 'image',
    })
    segFiles.push(out)
  }
  const concatPath = path.join(outDir, 'concat.mp4')
  await concatSegments(segFiles, concatPath)
  await burnSubtitles(concatPath, srtPath, path.join(outDir, 'draft.mp4'))

  await transitionTask(taskId, 'PREVIEW_PENDING', '初稿渲染完成，待预览')
}
