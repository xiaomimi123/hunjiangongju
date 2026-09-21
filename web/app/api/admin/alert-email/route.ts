// 运营告警邮箱：每日生图余额/用量日报的收件人。留空 = 停发。
import { NextResponse } from 'next/server'
import { prisma } from '@mixcut/db'
import { requireRole, HttpError } from '@/lib/auth'
import { handler } from '@/lib/api'

export const GET = handler(async () => {
  await requireRole('operator')
  const cfg = await prisma.siteConfig.findUnique({ where: { id: 1 } })
  return NextResponse.json({ alertEmail: cfg?.alertEmail ?? '' })
})

export const PUT = handler(async (req) => {
  await requireRole('operator')
  const body = await req.json().catch(() => {
    throw new HttpError(400, '请求体格式错误')
  })
  const email = typeof body.alertEmail === 'string' ? body.alertEmail.trim() : ''
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(400, '邮箱格式不正确（留空表示停发日报）')
  await prisma.siteConfig.upsert({
    where: { id: 1 },
    update: { alertEmail: email },
    create: { id: 1, alertEmail: email },
  })
  return NextResponse.json({ ok: true, alertEmail: email })
})
