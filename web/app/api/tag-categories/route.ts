import { NextResponse } from 'next/server'
import { prisma } from '@mixcut/db'
import { requireRole, HttpError } from '@/lib/auth'
import { handler } from '@/lib/api'

export const GET = handler(async () => {
  await requireRole()
  const tags = await prisma.tagCategory.findMany({ orderBy: [{ sortOrder: 'asc' }] })
  return NextResponse.json(tags)
})

export const POST = handler(async (req) => {
  await requireRole('operator')
  const { name, parentId } = await req.json()
  if (!name?.trim()) throw new HttpError(400, '名称不能为空')
  if (parentId) {
    const parent = await prisma.tagCategory.findUnique({ where: { id: parentId } })
    if (!parent) throw new HttpError(404, '父节点不存在')
  }
  const max = await prisma.tagCategory.aggregate({
    where: { parentId: parentId ?? null },
    _max: { sortOrder: true },
  })
  const tag = await prisma.tagCategory.create({
    data: { name: name.trim(), parentId: parentId ?? null, sortOrder: (max._max.sortOrder ?? 0) + 1 },
  })
  return NextResponse.json(tag)
})
