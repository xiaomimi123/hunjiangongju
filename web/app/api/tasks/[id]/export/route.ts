import { NextResponse } from 'next/server'
import { prisma } from '@mixcut/db'
import { requireRole, HttpError } from '@/lib/auth'
import { handler } from '@/lib/api'
import { loadTaskFor } from '@/lib/taskGuard'

export const GET = handler(async (_req, { params }) => {
  const session = await requireRole()
  const task = await loadTaskFor(session, params.id)
  if (task.status !== 'EXPORTED') throw new HttpError(409, '任务尚未导出')
  const exp = await prisma.export.findFirst({
    where: { taskId: params.id },
    orderBy: { createdAt: 'desc' },
  })
  if (!exp) throw new HttpError(404, '导出产物不存在')
  return NextResponse.json(exp)
})
