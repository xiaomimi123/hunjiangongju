import { NextResponse } from 'next/server'
import { prisma } from '@mixcut/db'
import { requireRole, HttpError } from '@/lib/auth'
import { handler } from '@/lib/api'

export const GET = handler(async (_req, { params }) => {
  await requireRole('operator')
  const source = await prisma.sourceVideo.findUnique({
    where: { id: params.id },
    select: {
      id: true,
      douyinShareUrl: true,
      videoFileUrl: true,
      status: true,
      createdAt: true,
      transcripts: {
        orderBy: { createdAt: 'desc' },
        take: 1,
        select: { id: true, fullText: true, sentences: true, createdAt: true },
      },
      sceneCuts: {
        select: { id: true, cutPointsMs: true },
      },
      frameworks: {
        orderBy: { createdAt: 'desc' },
        select: { id: true, name: true, industryCategory: true, createdAt: true },
      },
    },
  })
  if (!source) throw new HttpError(404, '拆解任务不存在')

  const { transcripts, ...rest } = source
  return NextResponse.json({ ...rest, transcript: transcripts[0] ?? null })
})
