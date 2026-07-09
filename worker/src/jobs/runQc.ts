import path from 'path'
import fs from 'fs/promises'
import { prisma, transitionTask, checkSubtitleOverflow } from '@mixcut/db'
import { DATA_DIR } from '../paths'
import { detectBlack, detectSilence } from '../ffmpeg'

export async function runQc(taskId: string): Promise<void> {
  const task = await prisma.task.findUniqueOrThrow({
    where: { id: taskId },
    include: {
      script: { select: { title: true } },
      segments: { orderBy: { orderNo: 'asc' }, include: { material: { select: { fileUrl: true } } } },
    },
  })
  const outDir = path.join(DATA_DIR, 'exports', taskId)
  const draft = path.join(outDir, 'draft.mp4')

  const black = await detectBlack(draft)
  const silence = await detectSilence(draft)
  const overflow = task.segments.filter((s) =>
    checkSubtitleOverflow(s.subtitleText ?? '', (s.endMs ?? 0) - s.startMs)
  )

  const checks: { checkType: string; result: string; detail: string }[] = [
    {
      checkType: 'black_frame',
      result: black.length === 0 ? 'pass' : 'fail',
      detail: black.length === 0 ? '未检出黑屏' : black.join('\n'),
    },
    {
      checkType: 'silence',
      result: silence.length === 0 ? 'pass' : 'fail',
      detail: silence.length === 0 ? '未检出静音' : silence.join('\n'),
    },
    {
      checkType: 'subtitle_overflow',
      result: overflow.length === 0 ? 'pass' : 'fail',
      detail: overflow.length === 0 ? '字幕语速正常' : `越界分镜段：${overflow.map((s) => s.orderNo).join('、')}`,
    },
  ]
  await prisma.qcReport.createMany({ data: checks.map((c) => ({ taskId, ...c })) })

  if (checks.some((c) => c.result === 'fail')) {
    await transitionTask(taskId, 'QC_FAILED', checks.filter((c) => c.result === 'fail').map((c) => c.checkType).join(', ') + ' 未通过')
    return
  }
  await transitionTask(taskId, 'QC_PASSED', '三项质检全部通过')

  // 生成导出产物
  await fs.copyFile(draft, path.join(outDir, 'final.mp4'))
  const project = {
    taskId,
    scriptTitle: task.script?.title,
    aspectRatio: task.aspectRatio,
    segments: task.segments.map((s) => ({
      orderNo: s.orderNo,
      subtitleText: s.subtitleText,
      startMs: s.startMs,
      endMs: s.endMs,
      materialFile: s.material?.fileUrl,
    })),
  }
  await fs.writeFile(path.join(outDir, 'project.json'), JSON.stringify(project, null, 2))
  const base = `/api/files/exports/${taskId}`
  await prisma.export.create({
    data: {
      taskId,
      videoUrl: `${base}/final.mp4`,
      subtitleUrl: `${base}/subtitle.srt`,
      projectJsonUrl: `${base}/project.json`,
    },
  })
  await transitionTask(taskId, 'EXPORTED', '导出完成')
}
