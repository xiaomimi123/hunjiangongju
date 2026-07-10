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

const MAX_ATTEMPTS = 5

export async function consumeCode(email: string, code: string, purpose: 'verify' | 'reset'): Promise<void> {
  if (!email || !code) throw new HttpError(400, '验证码无效或已过期')
  // 取该 email+purpose 最新一条未消费未过期的码（不按 hash 过滤，以便对错误尝试计数）
  const row = await prisma.emailCode.findFirst({
    where: { email, purpose, consumedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: 'desc' },
  })
  if (!row) throw new HttpError(400, '验证码无效或已过期')
  if (row.codeHash !== hashCode(code)) {
    const attempts = row.attempts + 1
    await prisma.emailCode.update({
      where: { id: row.id },
      // 连续错误达上限即作废该码，防暴力枚举
      data: { attempts, ...(attempts >= MAX_ATTEMPTS ? { consumedAt: new Date() } : {}) },
    })
    throw new HttpError(400, '验证码无效或已过期')
  }
  // 原子消费：只有把 consumedAt 从 null 改成非 null 的那次算成功，防并发双消费
  const consumed = await prisma.emailCode.updateMany({
    where: { id: row.id, consumedAt: null },
    data: { consumedAt: new Date() },
  })
  if (consumed.count !== 1) throw new HttpError(400, '验证码无效或已过期')
}
