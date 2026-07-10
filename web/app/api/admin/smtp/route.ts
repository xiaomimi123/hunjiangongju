import { NextResponse } from 'next/server'
import { prisma } from '@mixcut/db'
import { requireRole, HttpError } from '@/lib/auth'
import { handler } from '@/lib/api'
import { encrypt } from '@/lib/crypto'

export const GET = handler(async () => {
  await requireRole('operator')
  const row = await prisma.smtpConfig.findUnique({ where: { id: 1 } })
  return NextResponse.json({
    host: row?.host ?? '', port: row?.port ?? 465, secure: row?.secure ?? true,
    username: row?.username ?? '', fromAddress: row?.fromAddress ?? '', fromName: row?.fromName ?? '东方文澜',
    enabled: row?.enabled ?? false, hasPassword: !!row?.passwordEnc,
  })
})

export const PUT = handler(async (req) => {
  await requireRole('operator')
  const b = await req.json()
  if (b.enabled && !b.host?.trim()) throw new HttpError(400, '开启前请先填写 SMTP 主机')
  const port = Number(b.port)
  const data: Record<string, unknown> = {
    host: String(b.host ?? '').trim(), port: Number.isFinite(port) ? port : 465, secure: !!b.secure,
    username: String(b.username ?? '').trim(), fromAddress: String(b.fromAddress ?? '').trim(),
    fromName: String(b.fromName ?? '东方文澜').trim(), enabled: !!b.enabled,
  }
  if (typeof b.password === 'string' && b.password.length > 0) data.passwordEnc = encrypt(b.password)
  const row = await prisma.smtpConfig.upsert({
    where: { id: 1 },
    update: data,
    create: { id: 1, ...data },
  })
  return NextResponse.json({ ok: true, hasPassword: !!row.passwordEnc })
})
