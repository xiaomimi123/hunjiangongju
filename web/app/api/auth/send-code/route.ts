import { NextResponse } from 'next/server'
import { prisma } from '@mixcut/db'
import { HttpError } from '@/lib/auth'
import { handler } from '@/lib/api'
import { isEmail } from '@/lib/authcodes'
import { emailEnabled } from '@/lib/mailer'
import { sendCode } from '@/lib/emailflow'
import { checkRate } from '@/lib/ratelimit'

// 注册页「获取验证码」：给邮箱发一封注册验证码（与 register 解耦）
export const POST = handler(async (req) => {
  const { email } = await req.json()
  checkRate('send-code', String(email ?? '').toLowerCase(), 4)
  if (!isEmail(email)) throw new HttpError(400, '邮箱格式不正确')
  if (!(await emailEnabled())) throw new HttpError(400, '未开启邮件服务')
  if (await prisma.user.findUnique({ where: { email } })) throw new HttpError(409, '该邮箱已注册')
  await sendCode(email, 'verify')
  return NextResponse.json({ ok: true })
})
