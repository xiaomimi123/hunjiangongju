import { NextResponse } from 'next/server'
import { prisma, enqueueGen } from '@mixcut/db'
import { requireRole, HttpError } from '@/lib/auth'
import { handler } from '@/lib/api'

export const POST = handler(async (req) => {
  const session = await requireRole('operator')
  const { frameworkId, subject, variables } = await req.json().catch(() => {
    throw new HttpError(400, '请求体格式错误')
  })
  if (!frameworkId || typeof frameworkId !== 'string') throw new HttpError(400, '请选择框架')
  if (!subject || typeof subject !== 'string' || !subject.trim()) throw new HttpError(400, '选题不能为空')
  const fw = await prisma.copyFramework.findUnique({ where: { id: frameworkId } })
  if (!fw) throw new HttpError(400, '框架不存在')
  const task = await prisma.generationTask.create({
    data: {
      frameworkId,
      subject: subject.trim(),
      variables: variables ?? undefined,
      status: 'SCRIPT_GENERATING',
      createdBy: session.userId,
    },
  })
  await enqueueGen('generate-script', { genTaskId: task.id })
  return NextResponse.json({ id: task.id })
})

export const GET = handler(async () => {
  const session = await requireRole('operator')
  const tasks = await prisma.generationTask.findMany({
    where: { createdBy: session.userId },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true, subject: true, status: true, createdAt: true, updatedAt: true,
      framework: { select: { name: true } },
    },
  })
  return NextResponse.json(tasks)
})
