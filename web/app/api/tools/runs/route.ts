// 学员端：本人的扣子工具运行记录列表，倒序，取最近 50 条。
import { NextResponse } from 'next/server'
import { prisma } from '@mixcut/db'
import { requireRole } from '@/lib/auth'
import { handler } from '@/lib/api'

const PAGE_SIZE = 50

export const GET = handler(async () => {
  const s = await requireRole()
  const runs = await prisma.cozeToolRun.findMany({
    where: { userId: s.userId },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: PAGE_SIZE,
  })
  return NextResponse.json({ runs })
})
