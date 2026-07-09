import { NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { prisma } from '@mixcut/db'
import { signToken } from '@/lib/jwt'
import { HttpError } from '@/lib/auth'
import { handler } from '@/lib/api'

export const POST = handler(async (req) => {
  const { account, password, key } = await req.json()
  let user
  if (key) {
    const ak = await prisma.accessKey.findUnique({ where: { keyValue: key }, include: { user: true } })
    const expired = ak?.expiresAt ? ak.expiresAt < new Date() : false
    if (!ak || !ak.isActive || expired || !ak.user) throw new HttpError(401, '密钥无效或已过期')
    user = ak.user
  } else {
    if (!account || !password) throw new HttpError(400, '请填写账号和密码')
    user = await prisma.user.findUnique({ where: { account } })
    if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
      throw new HttpError(401, '账号或密码错误')
    }
  }
  const token = await signToken({ userId: user.id, role: user.role })
  const res = NextResponse.json({ role: user.role })
  res.cookies.set('token', token, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 7 * 24 * 3600,
  })
  return res
})
