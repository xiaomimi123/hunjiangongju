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
  // 令牌两端去空白：从扣子/控制台复制密钥极易带上尾部空格或换行，
  // 带着存进去会让请求头变成 `Bearer xxx␣`，扣子鉴权直接失败（4101/not found）
  if (typeof b.apiKey === 'string' && b.apiKey.trim().length > 0) data.apiKeyEnc = encrypt(b.apiKey.trim())
  const row = await prisma.aiCapabilityConfig.upsert({
    where: { capability: cap },
    update: data,
    create: { capability: cap, ...data },
  })
  return NextResponse.json({ ok: true, hasKey: !!row.apiKeyEnc })
})
