import { prisma } from '@mixcut/db'
import { genCode, hashCode } from './authcodes'
import { sendMail } from './mailer'
import { HttpError } from './auth'

const TTL_MS = 10 * 60 * 1000

export async function sendCode(email: string, purpose: 'verify' | 'reset'): Promise<void> {
  // 作废同邮箱同用途未消费旧码
  await prisma.emailCode.updateMany({
    where: { email, purpose, consumedAt: null },
    data: { consumedAt: new Date() },
  })
  const code = genCode()
  await prisma.emailCode.create({
    data: { email, purpose, codeHash: hashCode(code), expiresAt: new Date(Date.now() + TTL_MS) },
  })
  const title = purpose === 'verify' ? '注册验证码' : '重置密码验证码'
  await sendMail(email, `投流工作台 · ${title}`, `<p>你的${title}是 <b style="font-size:20px">${code}</b>，10 分钟内有效。</p>`)
}

export async function consumeCode(email: string, code: string, purpose: 'verify' | 'reset'): Promise<void> {
  const row = await prisma.emailCode.findFirst({
    where: { email, purpose, consumedAt: null, expiresAt: { gt: new Date() }, codeHash: hashCode(code) },
    orderBy: { createdAt: 'desc' },
  })
  if (!row) throw new HttpError(400, '验证码无效或已过期')
  await prisma.emailCode.update({ where: { id: row.id }, data: { consumedAt: new Date() } })
}
