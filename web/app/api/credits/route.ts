import { NextResponse } from 'next/server'
import { prisma } from '@mixcut/db'
import { requireRole } from '@/lib/auth'
import { handler } from '@/lib/api'

// 学员端：积分余额 + 导师收款二维码。二维码跟着余额一起给，
// 积分用完弹窗时不用再发一次请求。账号已删（会话残留）按 0 分报，不炸。
export const GET = handler(async () => {
  const s = await requireRole()
  const [me, cfg] = await Promise.all([
    prisma.user.findUnique({ where: { id: s.userId }, select: { credits: true } }),
    prisma.siteConfig.findUnique({ where: { id: 1 } }),
  ])
  return NextResponse.json({ credits: me?.credits ?? 0, qrUrl: cfg?.rechargeQrUrl ?? '' })
})
