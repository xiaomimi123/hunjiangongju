import { NextResponse } from 'next/server'
import { prisma } from '@mixcut/db'
import { requireRole } from '@/lib/auth'
import { handler } from '@/lib/api'

// 后台仪表盘聚合数据（v2.2：拆解 / 生成 维度）
export const GET = handler(async () => {
  await requireRole('operator')
  const startOfToday = new Date(); startOfToday.setHours(0, 0, 0, 0)

  const [
    totalStudents, todayNew,
    sourceVideos, sourceFailed,
    frameworks, publishedFrameworks,
    generationTasks, exportedWorks, publishedWorks,
    genByStatus, genPreviewPending, genFailed, renderFailed,
    recent,
  ] = await Promise.all([
    prisma.user.count({ where: { role: 'student' } }),
    prisma.user.count({ where: { role: 'student', createdAt: { gte: startOfToday } } }),
    prisma.sourceVideo.count(),
    prisma.sourceVideo.count({ where: { status: 'FAILED' } }),
    prisma.copyFramework.count(),
    prisma.copyFramework.count({ where: { published: true } }),
    prisma.generationTask.count(),
    prisma.generationTask.count({ where: { status: 'EXPORTED' } }),
    prisma.generationTask.count({ where: { published: true } }),
    prisma.generationTask.groupBy({ by: ['status'], _count: { _all: true } }),
    prisma.generationTask.count({ where: { status: 'PREVIEW_PENDING' } }),
    prisma.generationTask.count({ where: { status: 'FAILED' } }),
    prisma.renderTask.count({ where: { status: 'FAILED' } }),
    prisma.generationTask.findMany({
      orderBy: { createdAt: 'desc' }, take: 6,
      select: { id: true, subject: true, status: true, createdAt: true, createdBy: true, framework: { select: { name: true } } },
    }),
  ])

  // GenerationTask.createdBy 是裸 userId（无关系），单独查用户名
  const creatorIds = Array.from(new Set(recent.map((t) => t.createdBy).filter((v): v is string => !!v)))
  const creators = creatorIds.length
    ? await prisma.user.findMany({ where: { id: { in: creatorIds } }, select: { id: true, nickname: true, email: true } })
    : []
  const creatorMap = new Map(creators.map((u) => [u.id, u.nickname || u.email]))

  const statusCount: Record<string, number> = {}
  for (const g of genByStatus) statusCount[g.status] = g._count._all
  const sum = (keys: string[]) => keys.reduce((n, k) => n + (statusCount[k] ?? 0), 0)

  return NextResponse.json({
    stats: {
      totalStudents, todayNew,
      sourceVideos, frameworks, publishedFrameworks,
      generationTasks, exportedWorks, publishedWorks,
    },
    attention: {
      sourceFailed,
      genPreviewPending,
      genFailed,
      renderFailed,
    },
    funnel: {
      processing: sum(['GEN_CREATED', 'SCRIPT_GENERATING', 'IMAGE_GENERATING', 'TTS_GENERATING', 'CAPTION_ALIGNING', 'VISUAL_RENDERING', 'RENDERING', 'QC_RUNNING', 'QC_PASSED']),
      waiting: sum(['ASSET_READY', 'PREVIEW_PENDING', 'QC_FAILED']),
      done: statusCount['EXPORTED'] ?? 0,
      failed: statusCount['FAILED'] ?? 0,
    },
    recent: recent.map((t) => ({
      id: t.id, status: t.status, createdAt: t.createdAt,
      title: t.subject || t.framework?.name || '未命名生成',
      who: (t.createdBy && creatorMap.get(t.createdBy)) || '—',
    })),
  })
})
