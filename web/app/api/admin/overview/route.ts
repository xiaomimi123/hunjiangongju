import { NextResponse } from 'next/server'
import { prisma } from '@mixcut/db'
import { effStatus, summarizeGenTasks } from '@/lib/effStatus'
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
    generationTasks, allTasksEff, publishedWorks,
    renderFailed,
    recent,
  ] = await Promise.all([
    prisma.user.count({ where: { role: 'student' } }),
    prisma.user.count({ where: { role: 'student', createdAt: { gte: startOfToday } } }),
    prisma.sourceVideo.count(),
    prisma.sourceVideo.count({ where: { status: 'FAILED' } }),
    prisma.copyFramework.count(),
    prisma.copyFramework.count({ where: { published: true } }),
    prisma.generationTask.count(),
    // ★ 全部任务的「有效状态」汇总。不能按 generationTask.status 统计——
    // 渲染排队后它停在 VISUAL_RENDERING 不再前进，真实进度在最新 RenderTask 上：
    // 按它查 EXPORTED 的「已完成」恒为 0，仪表盘从上线起就是错的。
    prisma.generationTask.findMany({
      select: { status: true, renderTasks: { orderBy: { createdAt: 'desc' }, take: 1, select: { status: true } } },
    }),
    prisma.generationTask.count({ where: { published: true } }),
    prisma.renderTask.count({ where: { status: 'FAILED' } }),
    prisma.generationTask.findMany({
      orderBy: { createdAt: 'desc' }, take: 6,
      select: {
        id: true, subject: true, status: true, createdAt: true, createdBy: true,
        framework: { select: { name: true } },
        renderTasks: { orderBy: { createdAt: 'desc' }, take: 1, select: { status: true } },
      },
    }),
  ])

  // GenerationTask.createdBy 是裸 userId（无关系），单独查用户名
  const creatorIds = Array.from(new Set(recent.map((t) => t.createdBy).filter((v): v is string => !!v)))
  const creators = creatorIds.length
    ? await prisma.user.findMany({ where: { id: { in: creatorIds } }, select: { id: true, nickname: true, email: true } })
    : []
  const creatorMap = new Map(creators.map((u) => [u.id, u.nickname || u.email]))

  const eff = summarizeGenTasks(allTasksEff)

  return NextResponse.json({
    stats: {
      totalStudents, todayNew,
      sourceVideos, frameworks, publishedFrameworks,
      generationTasks, exportedWorks: eff.exported, publishedWorks,
    },
    attention: {
      sourceFailed,
      genPreviewPending: eff.previewPending,
      genFailed: eff.failed,
      renderFailed,
    },
    funnel: eff.funnel,
    recent: recent.map((t) => ({
      id: t.id, status: effStatus(t), createdAt: t.createdAt,
      title: t.subject || t.framework?.name || '未命名生成',
      who: (t.createdBy && creatorMap.get(t.createdBy)) || '—',
    })),
  })
})
