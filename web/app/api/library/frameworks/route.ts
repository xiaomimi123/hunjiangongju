import { NextResponse } from 'next/server'
import { prisma } from '@mixcut/db'
import { requireRole } from '@/lib/auth'
import { handler } from '@/lib/api'

export const GET = handler(async () => {
  await requireRole()
  const frameworks = await prisma.copyFramework.findMany({
    where: { published: true },
    select: {
      id: true,
      name: true,
      industryCategory: true,
      suggestedSegmentCount: true,
      imageStylePrompt: true,
    },
    orderBy: { createdAt: 'desc' },
  })
  return NextResponse.json(frameworks)
})
