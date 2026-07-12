import { NextResponse } from 'next/server'
import { prisma } from '@mixcut/db'
import { requireRole } from '@/lib/auth'
import { handler } from '@/lib/api'

// 后台仪表盘聚合数据
export const GET = handler(async () => {
  await requireRole('operator')
  const startOfToday = new Date(); startOfToday.setHours(0, 0, 0, 0)

  const [totalStudents, todayNew, totalTasks, exportedTasks, materials, images, scripts, publishedScripts, byStatus, recent] =
    await Promise.all([
      prisma.user.count({ where: { role: 'student' } }),
      prisma.user.count({ where: { role: 'student', createdAt: { gte: startOfToday } } }),
      prisma.task.count(),
      prisma.task.count({ where: { status: 'EXPORTED' } }),
      prisma.material.count(),
      prisma.material.count({ where: { kind: 'image' } }),
      prisma.script.count(),
      prisma.script.count({ where: { status: 'published' } }),
      prisma.task.groupBy({ by: ['status'], _count: { _all: true } }),
      prisma.task.findMany({
        orderBy: { createdAt: 'desc' }, take: 6,
        include: { script: { select: { title: true } }, user: { select: { nickname: true, email: true } } },
      }),
    ])

  const statusCount: Record<string, number> = {}
  for (const g of byStatus) statusCount[g.status] = g._count._all
  const sum = (keys: string[]) => keys.reduce((n, k) => n + (statusCount[k] ?? 0), 0)

  return NextResponse.json({
    stats: { totalStudents, todayNew, totalTasks, exportedTasks, materials, images, scripts, publishedScripts },
    attention: {
      materialPending: statusCount['MATERIAL_PENDING'] ?? 0,
      previewPending: statusCount['PREVIEW_PENDING'] ?? 0,
      qcFailed: statusCount['QC_FAILED'] ?? 0,
      failed: statusCount['FAILED'] ?? 0,
    },
    funnel: {
      processing: sum(['CREATED', 'SEGMENTING', 'MATCHING', 'STORYBOARD_READY', 'RENDERING', 'REVISING', 'QC_RUNNING', 'QC_PASSED']),
      waiting: sum(['MATERIAL_PENDING', 'PREVIEW_PENDING', 'QC_FAILED']),
      done: statusCount['EXPORTED'] ?? 0,
      failed: statusCount['FAILED'] ?? 0,
    },
    recent: recent.map((t) => ({
      id: t.id, status: t.status, createdAt: t.createdAt,
      title: t.script?.title ?? '未知文案',
      who: t.user?.nickname ?? t.user?.email ?? '—',
    })),
  })
})
