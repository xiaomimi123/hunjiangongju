// 学员端：实拍生图的展示配置（单张价格/是否开启）。不下发任何密钥或接口地址。
import { NextResponse } from 'next/server'
import { getCapabilityConfig } from '@mixcut/db'
import { requireRole } from '@/lib/auth'
import { handler } from '@/lib/api'
import { resolvePricePerImage } from '@/lib/photoInputs'

export const GET = handler(async () => {
  await requireRole()
  const cfg = await getCapabilityConfig('photo')
  return NextResponse.json({
    enabled: process.env.AI_MOCK === '1' || cfg.enabled,
    pricePerImage: resolvePricePerImage(cfg.extra),
  })
})
