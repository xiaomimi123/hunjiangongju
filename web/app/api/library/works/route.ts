import { NextResponse } from 'next/server'
import { prisma } from '@mixcut/db'
import { requireRole } from '@/lib/auth'
import { handler } from '@/lib/api'

/** 每页条数。成片库随发布量无界增长，全量返回迟早把页面拖卡 */
const PAGE_SIZE = 48

// 学员/运营成片库：已发布且存在 EXPORTED 成片的生成任务。游标分页。
export const GET = handler(async (req) => {
  await requireRole()
  const cursor = new URL(req.url).searchParams.get('cursor')?.trim() || undefined
  const rows = await prisma.generationTask.findMany({
    // EXPORTED 的过滤必须放进查询条件：原先是查回来再 filter，
    // 分页后那样会导致某页被滤空、页大小不稳
    where: { published: true, renderTasks: { some: { status: 'EXPORTED' } } },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: PAGE_SIZE + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    select: {
      id: true,
      subject: true,
      createdAt: true,
      framework: { select: { name: true } },
      renderTasks: {
        where: { status: 'EXPORTED' },
        orderBy: { createdAt: 'desc' },
        take: 1,
        select: { videoUrl: true, subtitleUrl: true },
      },
    },
  })
  const hasMore = rows.length > PAGE_SIZE
  const page = hasMore ? rows.slice(0, PAGE_SIZE) : rows
  const works = page
    .filter((t) => t.renderTasks.length > 0)
    .map((t) => ({
      id: t.id,
      subject: t.subject,
      framework: { name: t.framework?.name ?? null },
      videoUrl: t.renderTasks[0].videoUrl,
      subtitleUrl: t.renderTasks[0].subtitleUrl,
      createdAt: t.createdAt,
    }))
  return NextResponse.json({ works, ...(hasMore ? { nextCursor: page[page.length - 1]?.id } : {}) })
})
