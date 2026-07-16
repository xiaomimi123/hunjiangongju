import { NextResponse } from 'next/server'
import { prisma } from '@mixcut/db'
import { requireRole } from '@/lib/auth'
import { handler } from '@/lib/api'

export const GET = handler(async () => {
  const session = await requireRole('operator')
  const rows = await prisma.sourceVideo.findMany({
    where: { createdBy: session.userId },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      douyinShareUrl: true,
      status: true,
      createdAt: true,
      _count: { select: { frameworks: true } },
    },
  })
  return NextResponse.json(
    rows.map(({ _count, ...r }) => ({ ...r, frameworkCount: _count.frameworks })),
  )
})
