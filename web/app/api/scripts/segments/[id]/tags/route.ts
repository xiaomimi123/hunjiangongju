import { NextResponse } from 'next/server'
import { prisma } from '@mixcut/db'
import { requireRole, HttpError } from '@/lib/auth'
import { handler } from '@/lib/api'

export const PATCH = handler(async (req, { params }) => {
  await requireRole('operator')
  const { tagIds } = await req.json()
  if (!Array.isArray(tagIds)) throw new HttpError(400, 'tagIds 须为数组')
  await prisma.$transaction([
    prisma.segmentTag.deleteMany({ where: { segmentId: params.id } }),
    prisma.segmentTag.createMany({
      data: tagIds.map((tagId: string) => ({ segmentId: params.id, tagId })),
    }),
  ])
  return NextResponse.json({ ok: true })
})
