import { NextResponse } from 'next/server'
import { prisma, transitionTask, enqueue } from '@mixcut/db'
import { requireRole, HttpError } from '@/lib/auth'
import { handler } from '@/lib/api'

export const POST = handler(async (req, { params }) => {
  await requireRole('operator')
  const { materialId } = await req.json()
  const task = await prisma.task.findUnique({ where: { id: params.id } })
  if (!task) throw new HttpError(404, '任务不存在')
  if (task.status !== 'MATERIAL_PENDING') throw new HttpError(409, '当前状态不允许关联素材')
  const material = await prisma.material.findUnique({ where: { id: materialId } })
  if (!material) throw new HttpError(404, '素材不存在')
  const seg = await prisma.taskSegment.findFirst({ where: { id: params.segmentId, taskId: params.id } })
  if (!seg) throw new HttpError(404, '分镜片段不存在')
  await prisma.taskSegment.update({
    where: { id: params.segmentId },
    data: { materialId },
  })
  await transitionTask(params.id, 'MATCHING', `人工关联素材 ${materialId}`)
  await enqueue('match-materials', params.id)
  return NextResponse.json({ ok: true })
})
