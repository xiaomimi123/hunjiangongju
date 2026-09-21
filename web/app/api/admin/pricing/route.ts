// 积分定价：视频单价（SiteConfig.videoPriceCc，单位 0.01 积分）。
// 生图单价在「模型配置→实拍生图」的高级参数 pricePerImage；扣子工具单价在各工具上。
import { NextResponse } from 'next/server'
import { prisma, creditsToCc, formatCredits } from '@mixcut/db'
import { requireRole, HttpError } from '@/lib/auth'
import { handler } from '@/lib/api'

export const GET = handler(async () => {
  await requireRole('operator')
  const cfg = await prisma.siteConfig.findUnique({ where: { id: 1 } })
  return NextResponse.json({ videoPriceCredits: formatCredits(cfg?.videoPriceCc ?? 100) })
})

export const PUT = handler(async (req) => {
  await requireRole('operator')
  const body = await req.json().catch(() => {
    throw new HttpError(400, '请求体格式错误')
  })
  const cc = creditsToCc(body.videoPriceCredits)
  if (cc === null) throw new HttpError(400, '视频单价必须是 0-1000000 的数字，最多两位小数')
  await prisma.siteConfig.upsert({
    where: { id: 1 },
    update: { videoPriceCc: cc },
    create: { id: 1, videoPriceCc: cc },
  })
  return NextResponse.json({ ok: true, videoPriceCredits: formatCredits(cc) })
})
