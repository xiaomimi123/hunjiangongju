// 学员端：首页公告 Banner。只列已启用的，且字段收窄——学员不需要知道 enabled/sortOrder。
import { NextResponse } from 'next/server'
import { prisma } from '@mixcut/db'
import { requireRole } from '@/lib/auth'
import { handler } from '@/lib/api'

export const GET = handler(async () => {
  await requireRole()
  const banners = await prisma.banner.findMany({
    where: { enabled: true },
    orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
    select: { id: true, title: true, body: true, linkUrl: true },
  })
  return NextResponse.json({ banners })
})
