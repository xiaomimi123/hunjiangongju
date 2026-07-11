import { NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { prisma } from '@mixcut/db'
import { HttpError } from '@/lib/auth'
import { handler } from '@/lib/api'
import { isEmail } from '@/lib/authcodes'
import { consumeCode } from '@/lib/emailflow'
import { setSessionCookie } from '@/lib/session'
import { checkRate } from '@/lib/ratelimit'
import { assertPassword, nicknameFromEmail } from '@/lib/security'

export const POST = handler(async (req) => {
  const { email, code, password } = await req.json()
  checkRate('verify', String(email ?? '').toLowerCase(), 10)
  if (!isEmail(email)) throw new HttpError(400, '参数不完整')
  assertPassword(password)
  await consumeCode(email, String(code ?? ''), 'verify')
  if (await prisma.user.findUnique({ where: { email } })) throw new HttpError(409, '该邮箱已注册')
  try {
    const user = await prisma.user.create({
      data: { email, nickname: nicknameFromEmail(email), account: email, passwordHash: await bcrypt.hash(password, 10), role: 'student' },
    })
    return setSessionCookie(NextResponse.json({ role: user.role }), { userId: user.id, role: user.role })
  } catch (e) {
    if (e && typeof e === 'object' && (e as { code?: string }).code === 'P2002') throw new HttpError(409, '该邮箱已注册')
    throw e
  }
})
