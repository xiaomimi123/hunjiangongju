import { NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { prisma } from '@mixcut/db'
import { HttpError } from '@/lib/auth'
import { handler } from '@/lib/api'
import { isEmail } from '@/lib/authcodes'
import { consumeCode } from '@/lib/emailflow'
import { checkRate } from '@/lib/ratelimit'

export const POST = handler(async (req) => {
  const { email, code, newPassword } = await req.json()
  checkRate('reset', String(email ?? '').toLowerCase(), 10)
  if (!newPassword || newPassword.length < 6) throw new HttpError(400, '新密码至少 6 位')
  if (!isEmail(email)) throw new HttpError(400, '邮箱格式不正确')
  await consumeCode(email, String(code ?? ''), 'reset')
  const user = await prisma.user.findUnique({ where: { email } })
  if (!user) throw new HttpError(400, '账号不存在')
  await prisma.user.update({ where: { id: user.id }, data: { passwordHash: await bcrypt.hash(newPassword, 10) } })
  return NextResponse.json({ ok: true })
})
