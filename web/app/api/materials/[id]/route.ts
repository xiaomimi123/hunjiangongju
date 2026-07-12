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

// 修改素材标签（整组替换）
export const PATCH = handler(async (req, { params }) => {
  await requireRole('operator')
  const { tagIds } = await req.json()
  if (!Array.isArray(tagIds) || tagIds.length === 0) throw new HttpError(400, '请至少勾选一个标签')
  if ((await prisma.material.count({ where: { id: params.id } })) === 0) throw new HttpError(404, '素材不存在')
  await prisma.$transaction([
    prisma.materialTag.deleteMany({ where: { materialId: params.id } }),
    prisma.materialTag.createMany({ data: (tagIds as string[]).map((tagId) => ({ materialId: params.id, tagId })), skipDuplicates: true }),
  ])
  const m = await prisma.material.findUnique({ where: { id: params.id }, include: { tags: true } })
  return NextResponse.json(m)
})
