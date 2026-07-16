import { NextResponse } from 'next/server'
import { prisma } from '@mixcut/db'
import { requireRole, HttpError } from '@/lib/auth'
import { handler } from '@/lib/api'

export const GET = handler(async (_req, { params }) => {
  await requireRole('operator')
  const fw = await prisma.copyFramework.findUnique({ where: { id: params.id } })
  if (!fw) throw new HttpError(404, '框架不存在')
  return NextResponse.json(fw)
})

export const PATCH = handler(async (req, { params }) => {
  await requireRole('operator')
  const fw = await prisma.copyFramework.findUnique({ where: { id: params.id } })
  if (!fw) throw new HttpError(404, '框架不存在')
  const b = await req.json().catch(() => {
    throw new HttpError(400, '请求体格式错误')
  })
  const data: Record<string, unknown> = {}
  if (typeof b.name === 'string') data.name = b.name
  if (typeof b.frameworkText === 'string') {
    if (!b.frameworkText.trim()) throw new HttpError(400, '框架文案不能为空')
    data.frameworkText = b.frameworkText
  }
  if (typeof b.industryCategory === 'string') data.industryCategory = b.industryCategory
  if (typeof b.imageStylePrompt === 'string') data.imageStylePrompt = b.imageStylePrompt
  if (b.overlayTemplate !== undefined) data.overlayTemplate = b.overlayTemplate
  if (typeof b.renderTemplate === 'string') data.renderTemplate = b.renderTemplate
  if (b.maxLines !== undefined) data.maxLines = b.maxLines === null ? null : Number(b.maxLines)
  if (b.maxTotalChars !== undefined) data.maxTotalChars = b.maxTotalChars === null ? null : Number(b.maxTotalChars)
  if (b.suggestedSegmentCount !== undefined) data.suggestedSegmentCount = b.suggestedSegmentCount === null ? null : Number(b.suggestedSegmentCount)
  const updated = await prisma.copyFramework.update({ where: { id: params.id }, data })
  return NextResponse.json(updated)
})
