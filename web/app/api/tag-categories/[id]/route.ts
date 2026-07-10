import { NextResponse } from 'next/server'
import { prisma } from '@mixcut/db'
import { requireRole, HttpError } from '@/lib/auth'
import { handler } from '@/lib/api'

export const PATCH = handler(async (req, { params }) => {
  await requireRole('operator')
  const { name, parentId, sortOrder } = await req.json()
  const tag = await prisma.tagCategory.update({
    where: { id: params.id },
    data: {
      ...(name !== undefined ? { name: String(name).trim() } : {}),
      ...(parentId !== undefined ? { parentId } : {}),
      ...(sortOrder !== undefined ? { sortOrder: Number(sortOrder) } : {}),
    },
  })
  return NextResponse.json(tag)
})

export const DELETE = handler(async (_req, { params }) => {
  await requireRole('operator')
  const [mats, segs, children] = await Promise.all([
    prisma.materialTag.count({ where: { tagId: params.id } }),
    prisma.segmentTag.count({ where: { tagId: params.id } }),
    prisma.tagCategory.count({ where: { parentId: params.id } }),
  ])
  if (mats + segs > 0) throw new HttpError(409, `仍有 ${mats} 个素材、${segs} 个分段引用该标签`)
  if (children > 0) throw new HttpError(409, '请先删除子节点')
  await prisma.tagCategory.delete({ where: { id: params.id } })
  return NextResponse.json({ ok: true })
})
