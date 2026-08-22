import { NextResponse } from 'next/server'
import { prisma } from '@mixcut/db'
import { effStatus, summarizeEffCounts } from '@/lib/effStatus'
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
    // ★ 全部任务的「有效状态」汇总，且**在数据库内聚合**。
    // 不能按 generationTask.status 统计（渲染排队后它停在 VISUAL_RENDERING，
    // 真实进度在最新 RenderTask 上——按它查 EXPORTED 恒为 0）；
    // 也不能把全表拉回进程逐条算——任务上万后仪表盘先卡。
    // LATERAL 每任务取最新渲染态，COALESCE 回退生成态，GROUP BY 出计数表。
    prisma.$queryRaw<{ eff: string; n: bigint }[]>`
      SELECT COALESCE(rt.status, gt.status) AS eff, COUNT(*) AS n
      FROM generation_tasks gt
      LEFT JOIN LATERAL (
        SELECT status FROM render_tasks
        WHERE generation_task_id = gt.id
        ORDER BY created_at DESC LIMIT 1
      ) rt ON TRUE
      GROUP BY 1
    `,
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

  const effCounts: Record<string, number> = {}
  for (const r of allTasksEff) effCounts[r.eff] = Number(r.n)
  const eff = summarizeEffCounts(effCounts)

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
