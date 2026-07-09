import { NextResponse } from 'next/server'
import { prisma } from '@mixcut/db'
import { requireRole, HttpError } from '@/lib/auth'
import { handler } from '@/lib/api'

export const DELETE = handler(async (_req, { params }) => {
  await requireRole('operator')
  const used = await prisma.taskSegment.count({ where: { materialId: params.id } })
  if (used > 0) throw new HttpError(409, `该素材被 ${used} 个任务分镜使用，不能删除`)
  await prisma.material.delete({ where: { id: params.id } })
  return NextResponse.json({ ok: true })
})
