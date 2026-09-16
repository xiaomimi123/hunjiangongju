// 学员端：发起一次实拍生图。积分并发闸逐行照抄 web/app/api/tools/[id]/run/route.ts——
// updateMany 带 credits >= N 条件是乐观闸；扣分与建 run 同一事务；入队失败现场缝口退分。
import { NextResponse } from 'next/server'
import type { Prisma } from '@prisma/client'
import { prisma, enqueuePhotoGenRun, getCapabilityConfig } from '@mixcut/db'
import { requireRole, HttpError } from '@/lib/auth'
import { handler } from '@/lib/api'
import { checkRate } from '@/lib/ratelimit'
import { validatePhotoRun, resolvePricePerImage, totalPhotoPrice } from '@/lib/photoInputs'

export const POST = handler(async (req) => {
  const s = await requireRole()
  checkRate('photo-run', s.userId, 10)
  const body = await req.json().catch(() => {
    throw new HttpError(400, '请求体格式错误')
  })
  const params = validatePhotoRun(body)

  const cfg = await getCapabilityConfig('photo')
  if (process.env.AI_MOCK !== '1' && !cfg.enabled) {
    throw new HttpError(503, '实拍生图能力未开启，请联系运营在后台「模型配置」配置并启用')
  }
  const price = totalPhotoPrice(resolvePricePerImage(cfg.extra), params.count)

  const run = await prisma.$transaction(async (tx) => {
    if (s.role !== 'operator' && price > 0) {
      const claimed = await tx.user.updateMany({
        where: { id: s.userId, credits: { gte: price } },
        data: { credits: { decrement: price } },
      })
      if (claimed.count === 0) {
        const exists = await tx.user.count({ where: { id: s.userId } })
        if (exists > 0) throw new HttpError(403, '积分已用完，请扫码联系导师充值', 'NO_CREDITS')
      } else {
        // 扣费入流水：全站此前只有充值写 CreditLog，消费不写——导师在学员积分明细里
        // 对不上账（2026-09-16 线上就有「退分了但看着像没退」的误会）。photo 链路扣/退全记。
        await tx.creditLog.create({
          data: { userId: s.userId, delta: -price, reason: `实拍生图（${params.count} 张）` },
        })
      }
    }
    return tx.photoGenRun.create({
      data: {
        userId: s.userId,
        mode: params.mode,
        shotMode: params.shotMode,
        style: params.style,
        count: params.count,
        inputImage: params.inputImage,
        creditsCost: s.role === 'operator' ? 0 : price,
      } as Prisma.PhotoGenRunUncheckedCreateInput,
    })
  })

  try {
    await enqueuePhotoGenRun(run.id)
  } catch (err) {
    // 钱已扣、run 已建但入队失败：现场置 FAILED + 幂等退分（与 tools run 路由同款缝口）
    await prisma.$transaction(async (tx) => {
      const claimedFail = await tx.photoGenRun.updateMany({
        where: { id: run.id, status: { in: ['QUEUED', 'RUNNING'] } },
        data: { status: 'FAILED', errorMsg: '任务入队失败，请稍后重试', finishedAt: new Date() },
      })
      if (claimedFail.count === 0) return
      const claimedRefund = await tx.photoGenRun.updateMany({
        where: { id: run.id, refunded: false, creditsCost: { gt: 0 } },
        data: { refunded: true },
      })
      if (claimedRefund.count === 1) {
        await tx.user.updateMany({ where: { id: s.userId }, data: { credits: { increment: run.creditsCost } } })
        if (run.creditsCost > 0) {
          await tx.creditLog.create({
            data: { userId: s.userId, delta: run.creditsCost, reason: '实拍生图退回（入队失败）' },
          })
        }
      }
    })
    throw err
  }
  return NextResponse.json({ id: run.id })
})
