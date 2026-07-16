import path from 'path'
import { promises as fs } from 'fs'
import { prisma, transitionRender, writeQc, checkSubtitleOverflow } from '@mixcut/db'
import { DATA_DIR } from '../paths'
import { detectBlack, detectSilence } from '../ffmpeg'

interface Timing {
  seqNo: number
  startMs: number
  endMs: number
}

export async function runGenQc(renderTaskId: string): Promise<void> {
  const renderTask = await prisma.renderTask.findUniqueOrThrow({
    where: { id: renderTaskId },
    include: { task: true },
  })
  const genTaskId = renderTask.generationTaskId

  const finalAbs = path.join(DATA_DIR, 'gen', genTaskId, 'final.mp4')
  await fs.access(finalAbs) // 缺 final.mp4 直接抛，由 handler 置 FAILED

  await transitionRender(renderTaskId, 'QC_RUNNING')

  // 黑屏检测（真 pass/fail）
  const black = await detectBlack(finalAbs)
  await writeQc(
    renderTaskId,
    'black_frame',
    black.length === 0 ? 'pass' : 'fail',
    black.length === 0 ? '未检出黑屏' : black.join('\n'),
  )

  // 静音检测：P1 mock 音频全静音 → 记 warn 不 fail（真实配音接入后再严格）
  const silence = await detectSilence(finalAbs)
  await writeQc(
    renderTaskId,
    'silence',
    silence.length === 0 ? 'pass' : 'warn',
    silence.length === 0
      ? '未检出静音'
      : `检出静音（P1 mock/占位配音判为 warn 不阻断）：\n${silence.join('\n')}`,
  )

  // 字幕越界：bodyTimings 段长 vs scriptText 长度（真 pass/fail）
  const segments = await prisma.generatedSegment.findMany({
    where: { generationTaskId: genTaskId },
    orderBy: { seqNo: 'asc' },
  })
  const timings = Array.isArray(renderTask.task.bodyTimings)
    ? (renderTask.task.bodyTimings as unknown as Timing[])
    : []
  const timingBySeq = new Map(timings.map((t) => [t.seqNo, t]))
  const overflow = segments.filter((s) => {
    const t = timingBySeq.get(s.seqNo)
    if (!t) return false
    return checkSubtitleOverflow(s.scriptText, t.endMs - t.startMs)
  })
  await writeQc(
    renderTaskId,
    'subtitle_overflow',
    overflow.length === 0 ? 'pass' : 'fail',
    overflow.length === 0 ? '字幕语速正常' : `越界分镜段：${overflow.map((s) => s.seqNo).join('、')}`,
  )

  // 只有真 fail 才算硬失败；warn 放行
  const hardFail = black.length > 0 || overflow.length > 0
  if (hardFail) {
    const reasons: string[] = []
    if (black.length > 0) reasons.push('black_frame')
    if (overflow.length > 0) reasons.push('subtitle_overflow')
    await transitionRender(renderTaskId, 'QC_FAILED', `${reasons.join(', ')} 未通过`)
    return
  }

  await transitionRender(renderTaskId, 'QC_PASSED')
  await transitionRender(renderTaskId, 'EXPORTED')
  console.log(`[gen] run-gen-qc ${renderTaskId}: EXPORTED (silence=${silence.length > 0 ? 'warn' : 'pass'})`)
}
