import { NextResponse } from 'next/server'
import { prisma, CAPABILITIES, encrypt } from '@mixcut/db'
import { requireRole, HttpError } from '@/lib/auth'
import { handler } from '@/lib/api'

export const PUT = handler(async (req, { params }) => {
  await requireRole('operator')
  const cap = params.capability
  if (!(CAPABILITIES as string[]).includes(cap)) throw new HttpError(404, '未知能力')
  const b = await req.json()
  if (b.enabled && !String(b.baseUrl ?? '').trim()) throw new HttpError(400, '开启前请先填写接口地址')
  const data: Record<string, unknown> = {
    baseUrl: String(b.baseUrl ?? '').trim(),
    model: String(b.model ?? '').trim(),
    enabled: !!b.enabled,
    extra: b.extra ?? undefined,
  }
  if (typeof b.apiKey === 'string' && b.apiKey.length > 0) data.apiKeyEnc = encrypt(b.apiKey)
  const row = await prisma.aiCapabilityConfig.upsert({
    where: { capability: cap },
    update: data,
    create: { capability: cap, ...data },
  })
  return NextResponse.json({ ok: true, hasKey: !!row.apiKeyEnc })
})
