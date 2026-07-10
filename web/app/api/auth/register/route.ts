import { NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { prisma } from '@mixcut/db'
import { HttpError } from '@/lib/auth'
import { handler } from '@/lib/api'
import { isEmail } from '@/lib/authcodes'
import { emailEnabled } from '@/lib/mailer'
import { sendCode } from '@/lib/emailflow'
import { setSessionCookie } from '@/lib/session'

export const POST = handler(async (req) => {
  const { email, password, nickname } = await req.json()
  if (!isEmail(email)) throw new HttpError(400, '邮箱格式不正确')
  if (!password || password.length < 6) throw new HttpError(400, '密码至少 6 位')
  if (!nickname?.trim()) throw new HttpError(400, '请填写昵称')
  if (await prisma.user.findUnique({ where: { email } })) throw new HttpError(409, '该邮箱已注册')

  if (await emailEnabled()) {
    await sendCode(email, 'verify')
    return NextResponse.json({ needsVerification: true })
  }
  const user = await prisma.user.create({
    data: { email, nickname: nickname.trim(), account: email, passwordHash: await bcrypt.hash(password, 10), role: 'student' },
  })
  return setSessionCookie(NextResponse.json({ role: user.role, needsVerification: false }), { userId: user.id, role: user.role })
})
