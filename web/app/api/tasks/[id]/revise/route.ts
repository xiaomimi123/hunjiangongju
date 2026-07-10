import { NextResponse } from 'next/server'
import { prisma, transitionTask, enqueue } from '@mixcut/db'
import { requireRole, HttpError } from '@/lib/auth'
import { handler } from '@/lib/api'
import { loadTaskFor } from '@/lib/taskGuard'

export const POST = handler(async (req, { params }) => {
  const session = await requireRole()
  const task = await loadTaskFor(session, params.id)
  if (task.status !== 'PREVIEW_PENDING' && task.status !== 'QC_FAILED') {
    throw new HttpError(409, '当前状态不允许修改')
  }
  const { changes, order } = (await req.json()) as {
    changes?: { taskSegmentId: string; materialId?: string; subtitleText?: string }[]
    order?: string[]
  }
  const ownSegments = await prisma.taskSegment.findMany({
    where: { taskId: params.id },
    select: { id: true },
  })
  const ownSegmentIds = new Set(ownSegments.map((s) => s.id))
  for (const c of changes ?? []) {
    if (!ownSegmentIds.has(c.taskSegmentId)) throw new HttpError(404, '分镜片段不存在')
  }
  for (const segId of order ?? []) {
    if (!ownSegmentIds.has(segId)) throw new HttpError(404, '分镜片段不存在')
  }
  const updates = []
  for (const c of changes ?? []) {
    updates.push(prisma.taskSegment.update({
      where: { id: c.taskSegmentId },
      data: {
        ...(c.materialId !== undefined ? { materialId: c.materialId } : {}),
        ...(c.subtitleText !== undefined ? { subtitleText: c.subtitleText, endMs: null } : {}),
      },
    }))
  }
  ;(order ?? []).forEach((segId, i) => {
    updates.push(prisma.taskSegment.update({ where: { id: segId }, data: { orderNo: i + 1 } }))
  })
  if (updates.length === 0) throw new HttpError(400, '没有任何修改')
  await prisma.$transaction(updates)
  await transitionTask(params.id, 'REVISING', '提交局部修改')
  await transitionTask(params.id, 'RENDERING', '修改后重新渲染')
  await enqueue('render-draft', params.id)
  return NextResponse.json({ ok: true })
})
