// 单个 Banner：编辑（含启停）/ 删除。
import { NextResponse } from 'next/server'
import { prisma } from '@mixcut/db'
import { requireRole, HttpError } from '@/lib/auth'
import { handler } from '@/lib/api'
import { validateTitle, validateBody, validateLinkUrl, validateSortOrder } from '@/lib/bannerAdmin'

// 局部更新：传了哪个字段才校验/写哪个字段，未传的保持原样。
export const PATCH = handler(async (req, { params }) => {
  await requireRole('operator')
  const banner = await prisma.banner.findUnique({ where: { id: params.id } })
  if (!banner) throw new HttpError(404, 'Banner 不存在')

  const body = await req.json().catch(() => {
    throw new HttpError(400, '请求体格式错误')
  })

  const data: Record<string, unknown> = {}
  if ('title' in body) data.title = validateTitle(body.title)
  if ('body' in body) data.body = validateBody(body.body)
  if ('linkUrl' in body) data.linkUrl = validateLinkUrl(body.linkUrl)
  if ('enabled' in body) data.enabled = body.enabled === true
  if ('sortOrder' in body) data.sortOrder = validateSortOrder(body.sortOrder)

  const updated = await prisma.banner.update({ where: { id: banner.id }, data })
  return NextResponse.json(updated)
})

export const DELETE = handler(async (_req, { params }) => {
  await requireRole('operator')
  const banner = await prisma.banner.findUnique({ where: { id: params.id } })
  if (!banner) throw new HttpError(404, 'Banner 不存在')

  await prisma.banner.delete({ where: { id: banner.id } })
  return NextResponse.json({ ok: true })
})
