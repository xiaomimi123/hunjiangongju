import { NextResponse } from 'next/server'
import { prisma, enqueue } from '@mixcut/db'
import { requireRole, HttpError } from '@/lib/auth'
import { handler } from '@/lib/api'

export const POST = handler(async (req) => {
  const session = await requireRole()
  const { scriptId, aspectRatio } = await req.json()
  if (aspectRatio !== '9:16' && aspectRatio !== '16:9') throw new HttpError(400, '输出规格须为 9:16 或 16:9')
  const script = await prisma.script.findUnique({
    where: { id: scriptId },
    include: { _count: { select: { segments: true } } },
  })
  if (!script || script.status !== 'published') throw new HttpError(400, '文案不存在或未发布')
  if (script._count.segments === 0) throw new HttpError(400, '文案尚未分段')
  const task = await prisma.task.create({
    data: { userId: session.userId, scriptId, aspectRatio },
  })
  await enqueue('segment-script', task.id)
  return NextResponse.json(task)
})

export const GET = handler(async (req) => {
  const session = await requireRole()
  const status = new URL(req.url).searchParams.get('status')
  const tasks = await prisma.task.findMany({
    where: {
      ...(session.role === 'operator' ? {} : { userId: session.userId }),
      ...(status ? { status } : {}),
    },
    include: { script: { select: { title: true } } },
    orderBy: { createdAt: 'desc' },
  })
  return NextResponse.json(tasks)
})
