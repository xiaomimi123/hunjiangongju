import { NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { prisma } from '@mixcut/db'
import { HttpError } from '@/lib/auth'
import { handler } from '@/lib/api'
import { isEmail } from '@/lib/authcodes'
import { emailEnabled } from '@/lib/mailer'
import { sendCode } from '@/lib/emailflow'
import { setSessionCookie } from '@/lib/session'
import { checkRate } from '@/lib/ratelimit'
import { clientIp, assertPassword, nicknameFromEmail } from '@/lib/security'

export const POST = handler(async (req) => {
  const { email, password } = await req.json()
  checkRate('register-ip', clientIp(req), 20, 3600_000)
  checkRate('register', String(email ?? '').toLowerCase(), 5)
  if (!isEmail(email)) throw new HttpError(400, '邮箱格式不正确')
  assertPassword(password)
  if (await prisma.user.findUnique({ where: { email } })) throw new HttpError(409, '该邮箱已注册')

  if (await emailEnabled()) {
    await sendCode(email, 'verify')
    return NextResponse.json({ needsVerification: true })
  }
  try {
    const user = await prisma.user.create({
      data: { email, nickname: nicknameFromEmail(email), account: email, passwordHash: await bcrypt.hash(password, 10), role: 'student' },
    })
    return setSessionCookie(NextResponse.json({ role: user.role, needsVerification: false }), { userId: user.id, role: user.role })
  } catch (e) {
    if (e && typeof e === 'object' && (e as { code?: string }).code === 'P2002') throw new HttpError(409, '该邮箱已注册')
    throw e
  }
})
