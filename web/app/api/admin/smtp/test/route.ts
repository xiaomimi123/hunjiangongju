import { NextResponse } from 'next/server'
import { prisma } from '@mixcut/db'
import { requireRole, HttpError } from '@/lib/auth'
import { handler } from '@/lib/api'
import { decrypt } from '@/lib/crypto'
import { sendTestMail } from '@/lib/mailer'

export const POST = handler(async (req) => {
  await requireRole('operator')
  const b = await req.json()
  if (!b.to?.trim()) throw new HttpError(400, '请填写测试收件邮箱')
  const row = await prisma.smtpConfig.findUnique({ where: { id: 1 } })
  const host = String(b.host ?? row?.host ?? '').trim()
  if (!host) throw new HttpError(400, '请先填写 SMTP 主机')
  try {
    // 表单里若填了新密码用新密码，否则用库里已存的（解密失败也视为发送失败）
    const password = typeof b.password === 'string' && b.password ? b.password : decrypt(row?.passwordEnc ?? '')
    const cfg = {
      host, port: Number(b.port ?? row?.port ?? 465),
      secure: b.secure ?? row?.secure ?? true, username: String(b.username ?? row?.username ?? '').trim(),
      password, fromAddress: String(b.fromAddress ?? row?.fromAddress ?? '').trim(),
      fromName: String(b.fromName ?? row?.fromName ?? '投流工作台').trim(),
    }
    await sendTestMail(cfg, String(b.to).trim())
  } catch (e) {
    throw new HttpError(400, '发送失败：' + (e as Error).message)
  }
  return NextResponse.json({ ok: true })
})
