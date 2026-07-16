import { NextResponse } from 'next/server'
import { prisma, CAPABILITIES } from '@mixcut/db'
import { requireRole } from '@/lib/auth'
import { handler } from '@/lib/api'

export const GET = handler(async () => {
  await requireRole('operator')
  const rows = await prisma.aiCapabilityConfig.findMany()
  const byCap = new Map(rows.map((r) => [r.capability, r]))
  const list = CAPABILITIES.map((cap) => {
    const r = byCap.get(cap)
    return {
      capability: cap,
      baseUrl: r?.baseUrl ?? '',
      model: r?.model ?? '',
      enabled: r?.enabled ?? false,
      extra: r?.extra ?? {},
      hasKey: !!r?.apiKeyEnc,
    }
  })
  return NextResponse.json(list)
})
