import { NextResponse } from 'next/server'
import { transitionTask, enqueue } from '@mixcut/db'
import { requireRole, HttpError } from '@/lib/auth'
import { handler } from '@/lib/api'
import { loadTaskFor } from '@/lib/taskGuard'

// 卡在这些活动态、且没有对应 job 在跑的任务，可以被"重置并重试"：
// 先合法地转到 FAILED，再重新入队 segment-script 从头驱动一遍。
const RECOVERABLE_ACTIVE = new Set([
  'CREATED', 'SEGMENTING', 'MATCHING', 'STORYBOARD_READY', 'RENDERING', 'QC_RUNNING', 'REVISING',
])

// 这些状态有自己的处理路径或已终态，不应被重置，避免误伤运营/学员正在做的操作。
const GUIDANCE: Record<string, string> = {
  MATERIAL_PENDING: '当前任务缺少素材，请通过"关联素材"完成素材关联，而非重置重试',
  PREVIEW_PENDING: '当前任务待预览确认，请引导学员确认或由运营改稿，而非重置重试',
  QC_FAILED: '当前任务质检未通过，请改稿后重新质检，而非重置重试',
  EXPORTED: '当前任务已完成，无需重试',
}

export const POST = handler(async (_req, { params }) => {
  const session = await requireRole()
  const task = await loadTaskFor(session, params.id)

  if (task.status === 'FAILED') {
    await enqueue('segment-script', params.id)
    return NextResponse.json({ ok: true })
  }

  if (RECOVERABLE_ACTIVE.has(task.status)) {
    await transitionTask(params.id, 'FAILED', `手动重置：从 ${task.status} 恢复`)
    await enqueue('segment-script', params.id)
    return NextResponse.json({ ok: true })
  }

  throw new HttpError(400, GUIDANCE[task.status] ?? '当前状态不支持重置重试')
})
