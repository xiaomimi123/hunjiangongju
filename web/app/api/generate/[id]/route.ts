import { NextResponse } from 'next/server'
import { prisma } from '@mixcut/db'
import { requireRole, HttpError } from '@/lib/auth'
import { handler } from '@/lib/api'

export const GET = handler(async (_req, { params }) => {
  const session = await requireRole('operator')
  const task = await prisma.generationTask.findUnique({
    where: { id: params.id },
    include: {
      framework: { select: { id: true, name: true } },
      // published 供运营详情页反映「发布到成片库」开关状态
      segments: { orderBy: { seqNo: 'asc' }, select: { seqNo: true, scriptText: true, imageUrl: true } },
      renderTasks: {
        orderBy: { createdAt: 'desc' },
        select: { id: true, status: true, videoUrl: true, subtitleUrl: true },
      },
    },
  })
  if (!task || task.createdBy !== session.userId) throw new HttpError(404, '生成任务不存在')
  return NextResponse.json(task)
})
