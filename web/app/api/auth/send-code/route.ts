import { NextResponse } from 'next/server'
import { prisma } from '@mixcut/db'
import { HttpError } from '@/lib/auth'
import { handler } from '@/lib/api'
import { isEmail } from '@/lib/authcodes'
import { emailEnabled } from '@/lib/mailer'
import { registrationOpen } from '@/lib/registration'
import { sendCode } from '@/lib/emailflow'
import { checkRate } from '@/lib/ratelimit'
import { clientIp } from '@/lib/security'

// 注册页「获取验证码」：注册已改为手机号 + 密码，不再有邮箱验证码环节。
// 这个端点必须显式关闭而不是留着——留着等于给「11 位手机号」的账号规则开了
// 一条邮箱建号的旁路（直接调 API 就能绕过）。
export const POST = handler(async () => {
  throw new HttpError(410, '注册已改为手机号 + 密码，无需验证码')
})

const _legacy = handler(async (req) => {
  const { email } = await req.json()
  checkRate('send-code-ip', clientIp(req), 20, 3600_000) // IP 级：每小时 20 封，防邮件轰炸
  checkRate('send-code', String(email ?? '').toLowerCase(), 4)
  if (!(await registrationOpen())) throw new HttpError(403, '注册未开放')
  if (!isEmail(email)) throw new HttpError(400, '邮箱格式不正确')
  if (!(await emailEnabled())) throw new HttpError(400, '未开启邮件服务')
  if (await prisma.user.findUnique({ where: { email } })) throw new HttpError(409, '该邮箱已注册')
  await sendCode(email, 'verify')
  return NextResponse.json({ ok: true })
})
