import { NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { prisma } from '@mixcut/db'
import { HttpError } from '@/lib/auth'
import { handler } from '@/lib/api'
import { setSessionCookie } from '@/lib/session'

export const POST = handler(async (req) => {
  const { email, password } = await req.json()
  if (!email || !password) throw new HttpError(400, '请填写邮箱和密码')
  const user = await prisma.user.findUnique({ where: { email } })
  if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
    throw new HttpError(401, '邮箱或密码错误')
  }
  return setSessionCookie(NextResponse.json({ role: user.role }), { userId: user.id, role: user.role })
})
