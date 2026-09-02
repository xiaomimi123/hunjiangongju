// 首页公告 Banner：后台列表（含禁用）/ 新建。
import { NextResponse } from 'next/server'
import { prisma } from '@mixcut/db'
import { requireRole, HttpError } from '@/lib/auth'
import { handler } from '@/lib/api'
import { validateTitle, validateBody, validateLinkUrl, validateSortOrder } from '@/lib/bannerAdmin'

export const GET = handler(async () => {
  await requireRole('operator')
  const banners = await prisma.banner.findMany({
    orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
  })
  return NextResponse.json({ banners })
})

export const POST = handler(async (req) => {
  await requireRole('operator')
  const body = await req.json().catch(() => {
    throw new HttpError(400, '请求体格式错误')
  })

  const title = validateTitle(body.title)
  const bodyText = validateBody(body.body)
  const linkUrl = validateLinkUrl(body.linkUrl)
  const enabled = body.enabled === undefined ? true : body.enabled === true
  const sortOrder = body.sortOrder === undefined ? 0 : validateSortOrder(body.sortOrder)

  const banner = await prisma.banner.create({
    data: { title, body: bodyText, linkUrl, enabled, sortOrder },
  })
  return NextResponse.json(banner)
})
