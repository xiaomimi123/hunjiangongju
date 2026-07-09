import { NextResponse } from 'next/server'
import { prisma, splitScript } from '@mixcut/db'
import { requireRole, HttpError } from '@/lib/auth'
import { handler } from '@/lib/api'

export const POST = handler(async (_req, { params }) => {
  await requireRole('operator')
  const script = await prisma.script.findUnique({ where: { id: params.id } })
  if (!script) throw new HttpError(404, '文案不存在')
  const used = await prisma.taskSegment.count({
    where: { segment: { scriptId: params.id } },
  })
  if (used > 0) throw new HttpError(409, '已有任务使用该文案的分段，不能重新分段')
  const parts = splitScript(script.content)
  if (parts.length === 0) throw new HttpError(400, '文案内容为空，无法分段')
  await prisma.$transaction([
    prisma.scriptSegment.deleteMany({ where: { scriptId: params.id } }),
    prisma.scriptSegment.createMany({
      data: parts.map((text, i) => ({ scriptId: params.id, seqNo: i + 1, text })),
    }),
  ])
  const segments = await prisma.scriptSegment.findMany({
    where: { scriptId: params.id }, orderBy: { seqNo: 'asc' },
  })
  return NextResponse.json(segments)
})
