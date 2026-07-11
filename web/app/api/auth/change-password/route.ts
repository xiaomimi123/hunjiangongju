import { NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { prisma } from '@mixcut/db'
import { requireRole, HttpError } from '@/lib/auth'
import { handler } from '@/lib/api'
import { assertPassword } from '@/lib/security'

// 登录用户自助修改密码：校验当前密码后更新
export const POST = handler(async (req) => {
  const s = await requireRole()
  const { currentPassword, newPassword } = await req.json()
  assertPassword(newPassword)
  const user = await prisma.user.findUnique({ where: { id: s.userId } })
  if (!user) throw new HttpError(401, '未登录')
  if (!(await bcrypt.compare(String(currentPassword ?? ''), user.passwordHash))) {
    throw new HttpError(400, '当前密码不正确')
  }
  await prisma.user.update({ where: { id: user.id }, data: { passwordHash: await bcrypt.hash(newPassword, 10) } })
  return NextResponse.json({ ok: true })
})
