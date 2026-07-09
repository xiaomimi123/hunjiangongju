import { NextResponse } from 'next/server'
import { prisma } from '@mixcut/db'
import { requireRole } from '@/lib/auth'
import { handler } from '@/lib/api'
import { loadTaskFor } from '@/lib/taskGuard'

export const GET = handler(async (_req, { params }) => {
  const session = await requireRole()
  await loadTaskFor(session, params.id)
  const task = await prisma.task.findUnique({
    where: { id: params.id },
    include: {
      script: { select: { id: true, title: true } },
      segments: {
        orderBy: { orderNo: 'asc' },
        include: {
          material: { select: { id: true, fileUrl: true, thumbnailUrl: true, durationMs: true } },
          segment: { select: { text: true, tags: { select: { tagId: true } } } },
        },
      },
      statusLogs: { orderBy: { createdAt: 'asc' } },
      qcReports: { orderBy: { createdAt: 'desc' } },
      exports: { orderBy: { createdAt: 'desc' } },
    },
  })
  return NextResponse.json(task)
})
