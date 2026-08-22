import { NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { prisma } from '@mixcut/db'
import { HttpError } from '@/lib/auth'
import { handler } from '@/lib/api'
import { registrationOpen } from '@/lib/registration'
import { setSessionCookie } from '@/lib/session'
import { checkRate } from '@/lib/ratelimit'
import { clientIp, assertPassword, isPhoneAccount } from '@/lib/security'

// 注册 = 11 位手机号 + 密码（用户拍板的账号体系）。
// 不再有邮箱验证码环节——账号是手机号，没有邮箱可发；也没有短信通道，
// 真伪由「后台可禁用/删除」兜底。users.email 列继续当「账号」用（存手机号），
// 列名是历史遗留，不为改名单独跑一次迁移。
export const POST = handler(async (req) => {
  const { email, password } = await req.json()
  const phone = String(email ?? '').trim()
  checkRate('register-ip', clientIp(req), 20, 3600_000)
  checkRate('register', phone, 5)
  if (!(await registrationOpen())) throw new HttpError(403, '注册未开放')
  if (!isPhoneAccount(phone)) throw new HttpError(400, '请输入 11 位手机号')
  assertPassword(password)
  if (await prisma.user.findUnique({ where: { email: phone } })) throw new HttpError(409, '该手机号已注册')
  try {
    const user = await prisma.user.create({
      data: { email: phone, nickname: `学员${phone.slice(-4)}`, account: phone, passwordHash: await bcrypt.hash(password, 10), role: 'student' },
    })
    return setSessionCookie(NextResponse.json({ role: user.role, needsVerification: false }), { userId: user.id, role: user.role })
  } catch (e) {
    if (e && typeof e === 'object' && (e as { code?: string }).code === 'P2002') throw new HttpError(409, '该手机号已注册')
    throw e
  }
})
