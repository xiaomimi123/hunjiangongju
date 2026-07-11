import { NextResponse } from 'next/server'
import { prisma } from '@mixcut/db'
import { requireRole, HttpError } from '@/lib/auth'
import { handler } from '@/lib/api'

// 当前登录用户信息（供「我的」页 / 首页问候）
export const GET = handler(async () => {
  const s = await requireRole()
  const u = await prisma.user.findUnique({ where: { id: s.userId }, select: { email: true, nickname: true, role: true } })
  if (!u) throw new HttpError(401, '未登录')
  return NextResponse.json(u)
})
