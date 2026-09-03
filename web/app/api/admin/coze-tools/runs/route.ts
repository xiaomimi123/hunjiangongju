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
    // 列表页不需要 outputRaw/outputItems/inputs（体积可能很大），收窄字段避免全量吐给前端
    select: {
      id: true,
      toolId: true,
      userId: true,
      status: true,
      errorMsg: true,
      creditsCost: true,
      createdAt: true,
      finishedAt: true,
    },
  })

  const hasMore = rows.length > PAGE_SIZE
  const page = hasMore ? rows.slice(0, PAGE_SIZE) : rows

  // 运营要认得出这是哪个学员：裸 userId（UUID）没法用（上线真实反馈）。
  // CozeToolRun 没建 user 关系字段（当初刻意最小化 schema），这里二次查询合并即可——
  // 一页最多 60 条、去重后的 in 查询，成本可忽略。email 列存学员手机号（历史约定），前端打码。
  const userIds = Array.from(new Set(page.map((r) => r.userId)))
  const users = await prisma.user.findMany({
    where: { id: { in: userIds } },
    select: { id: true, nickname: true, email: true },
  })
  const byId = new Map(users.map((u) => [u.id, { nickname: u.nickname, email: u.email }]))
  const runs = page.map((r) => ({ ...r, user: byId.get(r.userId) ?? null }))
  return NextResponse.json({
    runs,
    ...(hasMore ? { nextCursor: runs[runs.length - 1]?.id } : {}),
  })
})
