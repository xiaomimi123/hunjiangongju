// 生图服务健康探针（后台横幅用）：无状态判定——最近一次生图运行若是「余额不足」类失败
// （402/insufficient balance），返回告警；充值后只要有新的成功运行，告警自然消失。
// 不依赖 worker 写标记、不加表：error_msg 本来就在库里。
import { NextResponse } from 'next/server'
import { prisma } from '@mixcut/db'
import { requireRole } from '@/lib/auth'
import { handler } from '@/lib/api'

const BALANCE_RE = /402|insufficient balance|欠费/i

export const GET = handler(async () => {
  await requireRole('operator')
  const latest = await prisma.photoGenRun.findFirst({
    orderBy: { createdAt: 'desc' },
    select: { status: true, errorMsg: true, createdAt: true },
  })
  if (!latest || latest.status !== 'FAILED' || !latest.errorMsg || !BALANCE_RE.test(latest.errorMsg)) {
    return NextResponse.json({ alert: null })
  }
  // 顺手统计近 6 小时被余额问题打掉的次数，横幅里说明影响面
  const failedCount = await prisma.photoGenRun.count({
    where: {
      status: 'FAILED',
      createdAt: { gte: new Date(Date.now() - 6 * 3600_000) },
      errorMsg: { contains: '402' },
    },
  })
  // 从报错原文里抓余额数字（如 current: 0.044492 USD），抓不到就不显示
  const m = latest.errorMsg.match(/current:\s*([\d.]+)\s*USD/i)
  return NextResponse.json({
    alert: {
      balance: m ? m[1] : null,
      failedCount,
      lastAt: latest.createdAt,
    },
  })
})
