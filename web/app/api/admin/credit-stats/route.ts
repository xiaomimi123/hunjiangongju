// 积分流水统计（近 30 天滚动窗口）：充值/消耗/退回总额、消耗按产品构成、
// 学员消耗排行（大户）与沉睡户。
//
// 口径说明：
// - 金额一律来自 CreditLog（单位 cc）。消费流水自 2026-09-21 积分 v2 起才记录，
//   之前的消耗不在账——排行榜按流水口径，前端注明起始日。
// - 「沉睡户」不用流水判（会把老活跃户误标沉睡），用三张业务表的真实活动记录判：
//   近 30 天没有生成任务、扣子运行、生图运行，且有余额、未禁用的学员。
import { NextResponse } from 'next/server'
import { prisma } from '@mixcut/db'
import { requireRole } from '@/lib/auth'
import { handler } from '@/lib/api'

const WINDOW_DAYS = 30
const RANK_SIZE = 10

function productOf(reason: string): 'video' | 'photo' | 'tool' | 'other' {
  if (reason === '生成视频') return 'video'
  if (reason.startsWith('实拍生图')) return 'photo'
  if (reason.startsWith('工具')) return 'tool'
  return 'other'
}

export const GET = handler(async () => {
  await requireRole('operator')
  const since = new Date(Date.now() - WINDOW_DAYS * 86400_000)

  const logs = await prisma.creditLog.findMany({
    where: { createdAt: { gte: since } },
    select: { userId: true, delta: true, reason: true },
  })

  let recharge = 0
  let consumed = 0
  let refunded = 0
  const byProduct: Record<'video' | 'photo' | 'tool' | 'other', number> = { video: 0, photo: 0, tool: 0, other: 0 }
  const consumedByUser = new Map<string, number>()
  for (const l of logs) {
    if (l.delta > 0) {
      if (l.reason === 'recharge') recharge += l.delta
      else refunded += l.delta
    } else if (l.delta < 0) {
      const amount = -l.delta
      consumed += amount
      byProduct[productOf(l.reason)] += amount
      consumedByUser.set(l.userId, (consumedByUser.get(l.userId) ?? 0) + amount)
    }
  }

  // 大户排行：近 30 天消耗 top N
  const topIds = Array.from(consumedByUser.entries()).sort((a, b) => b[1] - a[1]).slice(0, RANK_SIZE)
  const topUsers = topIds.length
    ? await prisma.user.findMany({
        where: { id: { in: topIds.map(([id]) => id) } },
        select: { id: true, email: true, nickname: true, credits: true },
      })
    : []
  const userById = new Map(topUsers.map((u) => [u.id, u]))
  const topConsumers = topIds
    .map(([id, cc]) => {
      const u = userById.get(id)
      return u ? { email: u.email, nickname: u.nickname, consumed: cc, credits: u.credits } : null
    })
    .filter(Boolean)

  // 沉睡户：有余额、未禁用的学员，近 30 天三类业务动作都没有
  const [activeGen, activeCoze, activePhoto] = await Promise.all([
    prisma.generationTask.findMany({ where: { createdAt: { gte: since }, createdBy: { not: null } }, select: { createdBy: true }, distinct: ['createdBy'] }),
    prisma.cozeToolRun.findMany({ where: { createdAt: { gte: since } }, select: { userId: true }, distinct: ['userId'] }),
    prisma.photoGenRun.findMany({ where: { createdAt: { gte: since } }, select: { userId: true }, distinct: ['userId'] }),
  ])
  const activeIds = new Set<string>(
    activeGen.map((t) => t.createdBy as string)
      .concat(activeCoze.map((r) => r.userId))
      .concat(activePhoto.map((r) => r.userId))
      // 有消费流水也算活跃（业务表齐全时是冗余，但多一道保险不会误标）
      .concat(Array.from(consumedByUser.keys())),
  )
  const dormant = (
    await prisma.user.findMany({
      where: { role: 'student', disabled: false, credits: { gt: 0 } },
      select: { id: true, email: true, nickname: true, credits: true, createdAt: true },
      orderBy: { credits: 'desc' },
    })
  )
    .filter((u) => !activeIds.has(u.id))
    .slice(0, RANK_SIZE)
    .map(({ id: _id, ...u }) => u)

  return NextResponse.json({
    windowDays: WINDOW_DAYS,
    summary: { recharge, consumed, refunded },
    byProduct,
    topConsumers,
    dormant,
  })
})
