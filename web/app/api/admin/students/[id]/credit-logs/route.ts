import { NextResponse } from 'next/server'
import { prisma } from '@mixcut/db'
import { requireRole } from '@/lib/auth'
import { handler } from '@/lib/api'

// 单个学员的充值流水（新到旧，最多 50 条——够导师对最近的账；更久远的进库查）
export const GET = handler(async (_req, { params }) => {
  await requireRole('operator')
  const logs = await prisma.creditLog.findMany({
    where: { userId: params.id },
    orderBy: { createdAt: 'desc' },
    take: 50,
    select: { id: true, delta: true, reason: true, createdAt: true },
  })
  return NextResponse.json({ logs })
})
