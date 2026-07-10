import { NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { prisma } from '@mixcut/db'
import { HttpError } from '@/lib/auth'
import { handler } from '@/lib/api'
import { isEmail } from '@/lib/authcodes'
import { consumeCode } from '@/lib/emailflow'
import { setSessionCookie } from '@/lib/session'

export const POST = handler(async (req) => {
  const { email, code, password, nickname } = await req.json()
  if (!isEmail(email) || !password || password.length < 6 || !nickname?.trim()) throw new HttpError(400, '参数不完整')
  await consumeCode(email, String(code ?? ''), 'verify')
  if (await prisma.user.findUnique({ where: { email } })) throw new HttpError(409, '该邮箱已注册')
  const user = await prisma.user.create({
    data: { email, nickname: nickname.trim(), account: email, passwordHash: await bcrypt.hash(password, 10), role: 'student' },
  })
  return setSessionCookie(NextResponse.json({ role: user.role }), { userId: user.id, role: user.role })
})
