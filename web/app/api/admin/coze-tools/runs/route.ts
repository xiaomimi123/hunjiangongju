// 全部运行记录（后台视角，跨用户）：倒序分页，同素材库分页同一套游标写法。
import { NextResponse } from 'next/server'
import { prisma } from '@mixcut/db'
import { requireRole } from '@/lib/auth'
import { handler } from '@/lib/api'

const PAGE_SIZE = 60

export const GET = handler(async (req) => {
  await requireRole('operator')
  const url = new URL(req.url)
  const cursor = url.searchParams.get('cursor')?.trim() || undefined
  const toolId = url.searchParams.get('toolId')?.trim() || undefined

  const rows = await prisma.cozeToolRun.findMany({
    where: toolId ? { toolId } : {},
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: PAGE_SIZE + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  })

  const hasMore = rows.length > PAGE_SIZE
  const runs = hasMore ? rows.slice(0, PAGE_SIZE) : rows
  return NextResponse.json({
    runs,
    ...(hasMore ? { nextCursor: runs[runs.length - 1]?.id } : {}),
  })
})
