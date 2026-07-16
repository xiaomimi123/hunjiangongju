import { NextResponse } from 'next/server'
import { prisma } from '@mixcut/db'
import { requireRole } from '@/lib/auth'
import { handler } from '@/lib/api'

// 学员/运营成片库：已发布且存在 EXPORTED 成片的生成任务。
export const GET = handler(async () => {
  await requireRole()
  const tasks = await prisma.generationTask.findMany({
    where: { published: true },
    orderBy: { createdAt: 'desc' },
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
  const works = tasks
    .filter((t) => t.renderTasks.length > 0)
    .map((t) => ({
      id: t.id,
      subject: t.subject,
      framework: { name: t.framework?.name ?? null },
      videoUrl: t.renderTasks[0].videoUrl,
      subtitleUrl: t.renderTasks[0].subtitleUrl,
      createdAt: t.createdAt,
    }))
  return NextResponse.json(works)
})
