// 学员端：我的生图记录列表（只看本人的，倒序，最多 50 条）。
import { NextResponse } from 'next/server'
import { prisma } from '@mixcut/db'
import { requireRole } from '@/lib/auth'
import { handler } from '@/lib/api'

export const GET = handler(async () => {
  const s = await requireRole()
  const runs = await prisma.photoGenRun.findMany({
    where: { userId: s.userId },
    orderBy: { createdAt: 'desc' },
    take: 50,
    select: {
      id: true, mode: true, shotMode: true, style: true, count: true, status: true,
      outputImages: true, creditsCost: true, refunded: true, createdAt: true, finishedAt: true,
    },
  })
  return NextResponse.json({ runs })
})
