import { NextResponse } from 'next/server'
import { prisma } from '@mixcut/db'
import { requireRole } from '@/lib/auth'
import { handler } from '@/lib/api'

export const GET = handler(async () => {
  await requireRole('operator')
  const rows = await prisma.copyFramework.findMany({
    orderBy: { createdAt: 'desc' },
    select: { id: true, name: true, industryCategory: true, visualStyleType: true, published: true, degradedNote: true, createdAt: true },
  })
  return NextResponse.json(rows)
})
