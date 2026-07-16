import { NextResponse } from 'next/server'
import { prisma } from '@mixcut/db'
import { requireRole, HttpError } from '@/lib/auth'
import { handler } from '@/lib/api'

// 发布到成片库：仅运营，且仅当最新 RenderTask 已 EXPORTED 时可发布/取消发布。
export const POST = handler(async (req, { params }) => {
  const session = await requireRole('operator')
  const task = await prisma.generationTask.findUnique({
    where: { id: params.id },
    include: { renderTasks: { orderBy: { createdAt: 'desc' }, take: 1, select: { status: true } } },
  })
  if (!task || task.createdBy !== session.userId) throw new HttpError(404, '生成任务不存在')
  const b = await req.json().catch(() => {
    throw new HttpError(400, '请求体格式错误')
  })
  if (typeof b.published !== 'boolean') throw new HttpError(400, 'published 需为布尔值')
  const latest = task.renderTasks[0]
  if (!latest || latest.status !== 'EXPORTED') throw new HttpError(400, '仅已完成成片可发布')
  await prisma.generationTask.update({ where: { id: task.id }, data: { published: b.published } })
  return NextResponse.json({ ok: true, published: b.published })
})
