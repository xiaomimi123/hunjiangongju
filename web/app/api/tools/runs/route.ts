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
    // 收窄字段：不给 inputs/outputRaw——outputRaw 是扣子原始响应整包，可能含 debug_url
    // 之类带 workflow_id 的字段，学员端不该看到；inputs 列表页也用不上，体积还可能较大。
    select: {
      id: true, toolId: true, status: true, errorMsg: true,
      creditsCost: true, outputItems: true, createdAt: true, finishedAt: true,
    },
  })
  return NextResponse.json({ runs })
})
