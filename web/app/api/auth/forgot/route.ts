import { NextResponse } from 'next/server'
import { prisma } from '@mixcut/db'
import { HttpError } from '@/lib/auth'
import { handler } from '@/lib/api'
import { isEmail } from '@/lib/authcodes'
import { emailEnabled } from '@/lib/mailer'
import { sendCode } from '@/lib/emailflow'

export const POST = handler(async (req) => {
  const { email } = await req.json()
  if (!isEmail(email)) throw new HttpError(400, '邮箱格式不正确')
  if (!(await emailEnabled())) throw new HttpError(400, '未开启邮件服务')
  const user = await prisma.user.findUnique({ where: { email } })
  if (user) { void sendCode(email, 'reset').catch((e) => console.error('sendCode(reset) failed:', e)) }
  return NextResponse.json({ ok: true }) // 无论是否存在都 200，防枚举
})
