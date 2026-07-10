import { NextResponse } from 'next/server'
import { prisma } from '@mixcut/db'
import { requireRole, HttpError } from '@/lib/auth'
import { handler } from '@/lib/api'

export const GET = handler(async (_req, { params }) => {
  const session = await requireRole()
  const script = await prisma.script.findUnique({
    where: { id: params.id },
    include: { segments: { orderBy: { seqNo: 'asc' }, include: { tags: true } } },
  })
  if (!script) throw new HttpError(404, '文案不存在')
  if (session.role !== 'operator' && script.status !== 'published') {
    throw new HttpError(404, '文案不存在')
  }
  return NextResponse.json(script)
})

export const PATCH = handler(async (req, { params }) => {
  await requireRole('operator')
  const { title, content, status } = await req.json()
  if (status === 'published') {
    const count = await prisma.scriptSegment.count({ where: { scriptId: params.id } })
    if (count === 0) throw new HttpError(400, '发布前请先自动分段')
  }
  const script = await prisma.script.update({
    where: { id: params.id },
    data: {
      ...(title !== undefined ? { title } : {}),
      ...(content !== undefined ? { content } : {}),
      ...(status !== undefined ? { status } : {}),
    },
  })
  return NextResponse.json(script)
})
