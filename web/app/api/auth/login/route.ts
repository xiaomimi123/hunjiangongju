import { NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { prisma } from '@mixcut/db'
import { HttpError } from '@/lib/auth'
import { handler } from '@/lib/api'
import { setSessionCookie } from '@/lib/session'
import { checkRate } from '@/lib/ratelimit'

// 邮箱不存在时也拿它做一次 bcrypt 比对，拉平响应耗时，防止据此枚举账号
const DUMMY_HASH = bcrypt.hashSync('unused-placeholder', 10)

export const POST = handler(async (req) => {
  const { email, password } = await req.json()
  checkRate('login', String(email ?? '').toLowerCase(), 8)
  if (!email || !password) throw new HttpError(400, '请填写邮箱和密码')
  const user = await prisma.user.findUnique({ where: { email } })
  const ok = await bcrypt.compare(String(password), user?.passwordHash ?? DUMMY_HASH)
  if (!user || !ok) throw new HttpError(401, '邮箱或密码错误')
  if (user.disabled) throw new HttpError(403, '账号已被禁用，请联系管理员')
  return setSessionCookie(NextResponse.json({ role: user.role }), { userId: user.id, role: user.role })
})
