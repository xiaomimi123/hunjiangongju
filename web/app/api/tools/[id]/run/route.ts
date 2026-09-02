// 学员端：运行一次扣子工具。积分并发闸逐行照抄 web/app/api/generate/route.ts 的写法——
// updateMany 带 credits >= N 条件是乐观闸，两个并发请求抢最后一点分只放行一个；
// 扣分与建 run 记录同一事务，中途失败不白扣。
import { NextResponse } from 'next/server'
import type { Prisma } from '@prisma/client'
import { prisma, enqueueCozeRun } from '@mixcut/db'
import { requireRole, HttpError } from '@/lib/auth'
import { handler } from '@/lib/api'
import { checkRate } from '@/lib/ratelimit'
import { validateInputsAgainst } from '@/lib/cozeInputs'

export const POST = handler(async (req, { params }) => {
  const s = await requireRole()
  checkRate('coze-run', s.userId, 10) // 10 次/分钟防刷
  const body = await req.json().catch(() => {
    throw new HttpError(400, '请求体格式错误')
  })
  const tool = await prisma.cozeTool.findUnique({ where: { id: params.id } })
  if (!tool || !tool.enabled) throw new HttpError(404, '工具不存在或已下架')
  const inputs = validateInputsAgainst(tool.inputs, body.inputs) // 逐项校验：必填、select 值在 options 内、image 是本站 coze-uploads 相对路径
  const run = await prisma.$transaction(async (tx) => {
    if (s.role !== 'operator' && tool.priceCredits > 0) {
      const claimed = await tx.user.updateMany({
        where: { id: s.userId, credits: { gte: tool.priceCredits } },
        data: { credits: { decrement: tool.priceCredits } },
      })
      if (claimed.count === 0) {
        // 分不够或账号已不存在。学员被删号但会话 cookie 还活着的情况沿用 generate 的语义：任务照建、账记不上即可
        const exists = await tx.user.count({ where: { id: s.userId } })
        if (exists > 0) throw new HttpError(403, '积分已用完，请扫码联系导师充值', 'NO_CREDITS')
      }
    }
    return tx.cozeToolRun.create({
      data: {
        toolId: tool.id,
        userId: s.userId,
        inputs: inputs as Prisma.InputJsonValue,
        creditsCost: s.role === 'operator' ? 0 : tool.priceCredits,
      },
    })
  })
  try {
    await enqueueCozeRun(run.id)
  } catch (err) {
    // 钱已扣、run 已建，但入队失败（如 redis 挂了）意味着这条 run 永远不会被 worker 处理、
    // 会永远停在 QUEUED。缝隙必须现场缝上：把 run 置 FAILED + 幂等退分（同一事务，抢闸写法
    // 与 worker 的 failRun 完全一致，见 worker/src/coze/run.ts:123-139），再把原错误抛出去，
    // 让学员看到失败而不是一个此后再也不会推进的假成功。
    await prisma.$transaction(async (tx) => {
      const claimedFail = await tx.cozeToolRun.updateMany({
        where: { id: run.id, status: { in: ['QUEUED', 'RUNNING'] } },
        data: { status: 'FAILED', errorMsg: '任务入队失败，请稍后重试', finishedAt: new Date() },
      })
      if (claimedFail.count === 0) return
      const claimedRefund = await tx.cozeToolRun.updateMany({
        where: { id: run.id, refunded: false, creditsCost: { gt: 0 } },
        data: { refunded: true },
      })
      if (claimedRefund.count === 1) {
        await tx.user.updateMany({ where: { id: s.userId }, data: { credits: { increment: run.creditsCost } } })
      }
    })
    throw err
  }
  return NextResponse.json({ id: run.id })
})
