// 积分定价：视频单价（SiteConfig.videoPriceCc）+ 生图单价（photo 能力 extra.pricePerImage，
// 与「模型配置→实拍生图」高级参数是同一个值，这里只是显式入口）。扣子工具单价在各工具上。
import { NextResponse } from 'next/server'
import { prisma, creditsToCc, formatCredits, getCapabilityConfig } from '@mixcut/db'
import { requireRole, HttpError } from '@/lib/auth'
import { handler } from '@/lib/api'
import { resolvePricePerImage } from '@/lib/photoInputs'

export const GET = handler(async () => {
  await requireRole('operator')
  const cfg = await prisma.siteConfig.findUnique({ where: { id: 1 } })
  const photoCfg = await getCapabilityConfig('photo')
  return NextResponse.json({
    videoPriceCredits: formatCredits(cfg?.videoPriceCc ?? 100),
    photoPriceCredits: resolvePricePerImage(photoCfg.extra).toFixed(2),
  })
})

export const PUT = handler(async (req) => {
  await requireRole('operator')
  const body = await req.json().catch(() => {
    throw new HttpError(400, '请求体格式错误')
  })
  const out: Record<string, string> = {}

  if ('videoPriceCredits' in body) {
    const cc = creditsToCc(body.videoPriceCredits)
    if (cc === null) throw new HttpError(400, '视频单价必须是 0-1000000 的数字，最多两位小数')
    await prisma.siteConfig.upsert({
      where: { id: 1 },
      update: { videoPriceCc: cc },
      create: { id: 1, videoPriceCc: cc },
    })
    out.videoPriceCredits = formatCredits(cc)
  }

  if ('photoPriceCredits' in body) {
    const cc = creditsToCc(body.photoPriceCredits)
    if (cc === null || cc > 10000) throw new HttpError(400, '生图单价必须是 0-100 积分，最多两位小数')
    const price = cc / 100 // extra.pricePerImage 的历史单位是「积分」数值（如 0.08）
    // merge 写回：只动 pricePerImage，保留 resolution 等其他高级参数
    const row = await prisma.aiCapabilityConfig.findUnique({ where: { capability: 'photo' } })
    const extra = { ...((row?.extra as Record<string, unknown> | null) ?? {}), pricePerImage: price }
    await prisma.aiCapabilityConfig.upsert({
      where: { capability: 'photo' },
      update: { extra },
      create: { capability: 'photo', baseUrl: '', model: '', enabled: false, extra },
    })
    out.photoPriceCredits = price.toFixed(2)
  }

  if (Object.keys(out).length === 0) throw new HttpError(400, '没有要保存的定价字段')
  return NextResponse.json({ ok: true, ...out })
})
