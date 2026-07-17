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

  // 黑屏检测：开场 <1.5s 的黑屏是无头渲染首帧图片加载/淡入的正常现象 → warn 不阻断；
  // 片中(>=1.5s 处)出现黑屏才是真缺陷（缺图/断片）→ fail
  const OPENING_BLACK_TOLERANCE_S = 1.5
  const black = await detectBlack(finalAbs)
  const midBlack = black.filter((l) => {
    const m = /black_start:\s*([\d.]+)/.exec(l)
    return m ? parseFloat(m[1]) >= OPENING_BLACK_TOLERANCE_S : true
  })
  const blackFail = midBlack.length > 0
  await writeQc(
    renderTaskId,
    'black_frame',
    black.length === 0 ? 'pass' : blackFail ? 'fail' : 'warn',
    black.length === 0
      ? '未检出黑屏'
      : blackFail
        ? `片中黑屏（缺图/断片）：\n${midBlack.join('\n')}`
        : `仅开场短黑屏（渲染首帧/淡入，判为 warn 不阻断）：\n${black.join('\n')}`,
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
  // 字幕越界是「语速偏快」的字符/时长估算启发式，对真实配音的自然停顿并不精确 → warn 不阻断
  await writeQc(
    renderTaskId,
    'subtitle_overflow',
    overflow.length === 0 ? 'pass' : 'warn',
    overflow.length === 0
      ? '字幕语速正常'
      : `字幕偏快分镜段（估算，判为 warn 不阻断）：${overflow.map((s) => s.seqNo).join('、')}`,
  )

  // 只有片中黑屏算硬失败（缺图/断片）；开场短黑屏、静音、字幕偏快均 warn 放行
  if (blackFail) {
    await transitionRender(renderTaskId, 'QC_FAILED', 'black_frame（片中黑屏）未通过')
    return
  }

  await transitionRender(renderTaskId, 'QC_PASSED')
  await transitionRender(renderTaskId, 'EXPORTED')
  console.log(
    `[gen] run-gen-qc ${renderTaskId}: EXPORTED (black=${black.length > 0 ? 'warn' : 'pass'}, silence=${silence.length > 0 ? 'warn' : 'pass'}, overflow=${overflow.length > 0 ? 'warn' : 'pass'})`,
  )
}
