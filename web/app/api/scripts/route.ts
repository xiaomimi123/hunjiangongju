import { NextResponse } from 'next/server'
import { prisma } from '@mixcut/db'
import { requireRole, HttpError } from '@/lib/auth'
import { handler } from '@/lib/api'

export const GET = handler(async () => {
  const session = await requireRole()
  const scripts = await prisma.script.findMany({
    where: session.role === 'operator' ? {} : { status: 'published' },
    include: { _count: { select: { segments: true } } },
    orderBy: { createdAt: 'desc' },
  })
  return NextResponse.json(scripts)
})

export const POST = handler(async (req) => {
  const session = await requireRole('operator')
  const { title, content } = await req.json()
  if (!title?.trim() || !content?.trim()) throw new HttpError(400, '标题与内容不能为空')
  const script = await prisma.script.create({
    data: { title: title.trim(), content, createdBy: session.userId },
  })
  return NextResponse.json(script)
})
