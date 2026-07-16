import { NextResponse } from 'next/server'
import { prisma, enqueueGen } from '@mixcut/db'
import { requireRole, HttpError } from '@/lib/auth'
import { handler } from '@/lib/api'

// 确认预览 → 提交质检：最新 RenderTask 处于 PREVIEW_PENDING 时，交给 run-gen-qc。
export const POST = handler(async (_req, { params }) => {
  const session = await requireRole('operator')
  const task = await prisma.generationTask.findUnique({ where: { id: params.id } })
  if (!task || task.createdBy !== session.userId) throw new HttpError(404, '生成任务不存在')
  const rt = await prisma.renderTask.findFirst({
    where: { generationTaskId: task.id },
    orderBy: { createdAt: 'desc' },
  })
  if (!rt || rt.status !== 'PREVIEW_PENDING') throw new HttpError(400, '当前没有待确认的预览')
  await enqueueGen('run-gen-qc', { renderTaskId: rt.id })
  return NextResponse.json({ ok: true })
})
