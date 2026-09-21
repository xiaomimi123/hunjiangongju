// 全站积分流水（分页 + 筛选）。学员数据页那份是单学员充值记录，这里是全量账本。
import { NextResponse } from 'next/server'
import type { Prisma } from '@prisma/client'
import { prisma } from '@mixcut/db'
import { requireRole } from '@/lib/auth'
import { handler } from '@/lib/api'

const PAGE_SIZE = 50

export const GET = handler(async (req) => {
  await requireRole('operator')
  const url = new URL(req.url)
  const q = url.searchParams.get('q')?.trim() ?? ''
  const type = url.searchParams.get('type') ?? '' // recharge | consume | refund
  const offset = Math.max(0, Number(url.searchParams.get('offset')) || 0)

  const where: Prisma.CreditLogWhereInput = {}
  if (type === 'recharge') where.reason = 'recharge'
  else if (type === 'consume') where.delta = { lt: 0 }
  else if (type === 'refund') Object.assign(where, { delta: { gt: 0 }, reason: { not: 'recharge' } })
  if (q) {
    const users = await prisma.user.findMany({
      where: { OR: [{ email: { contains: q } }, { nickname: { contains: q } }] },
      select: { id: true },
      take: 200,
    })
    where.userId = { in: users.map((u) => u.id) }
  }

  const rows = await prisma.creditLog.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    skip: offset,
    take: PAGE_SIZE + 1,
    select: { id: true, userId: true, delta: true, reason: true, createdAt: true },
  })
  const hasMore = rows.length > PAGE_SIZE
  const page = rows.slice(0, PAGE_SIZE)

  const users = await prisma.user.findMany({
    where: { id: { in: Array.from(new Set(page.map((r) => r.userId))) } },
    select: { id: true, email: true, nickname: true },
  })
  const byId = new Map(users.map((u) => [u.id, u]))
  const logs = page.map((r) => ({
    id: r.id,
    delta: r.delta,
    reason: r.reason,
    createdAt: r.createdAt,
    email: byId.get(r.userId)?.email ?? '(已删除)',
    nickname: byId.get(r.userId)?.nickname ?? null,
  }))
  return NextResponse.json({ logs, hasMore, nextOffset: offset + page.length })
})
