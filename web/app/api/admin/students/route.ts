import { NextResponse } from 'next/server'
import { prisma } from '@mixcut/db'
import { requireRole } from '@/lib/auth'
import { handler } from '@/lib/api'

export const GET = handler(async (req) => {
  await requireRole('operator')
  const url = new URL(req.url)
  const search = (url.searchParams.get('search') ?? '').trim()
  // ?? 默认值处理"参数缺失"（get() 返回 null → Number(null)=0 会误判为有效），Number.isFinite 处理"非数字"
  const pageRaw = Number(url.searchParams.get('page') ?? 1)
  const page = Number.isFinite(pageRaw) ? Math.max(1, Math.trunc(pageRaw)) : 1
  const pageSizeRaw = Number(url.searchParams.get('pageSize') ?? 20)
  const pageSize = Number.isFinite(pageSizeRaw) ? Math.min(50, Math.max(1, Math.trunc(pageSizeRaw))) : 20

  const where = {
    role: 'student',
    ...(search ? { OR: [{ email: { contains: search, mode: 'insensitive' as const } }, { nickname: { contains: search, mode: 'insensitive' as const } }] } : {}),
  }

  const startOfToday = new Date(); startOfToday.setHours(0, 0, 0, 0)
  const [total, totalStudents, todayNew, totalTasks, totalExported, rows] = await Promise.all([
    prisma.user.count({ where }),
    prisma.user.count({ where: { role: 'student' } }),
    prisma.user.count({ where: { role: 'student', createdAt: { gte: startOfToday } } }),
    prisma.generationTask.count(),
    prisma.generationTask.count({ where: { status: 'EXPORTED' } }),
    prisma.user.findMany({
      where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * pageSize, take: pageSize,
      select: { id: true, email: true, nickname: true, disabled: true, createdAt: true },
    }),
  ])

  // 学员作品 = 该学员发起的生成任务（generationTask.createdBy 为普通字段，非关系，用聚合统计）
  const ids = rows.map((u) => u.id)
  const genTasks = ids.length
    ? await prisma.generationTask.findMany({ where: { createdBy: { in: ids } }, select: { createdBy: true, status: true } })
    : []
  const byUser = new Map<string, { total: number; done: number }>()
  for (const t of genTasks) {
    if (!t.createdBy) continue
    const e = byUser.get(t.createdBy) ?? { total: 0, done: 0 }
    e.total++; if (t.status === 'EXPORTED') e.done++
    byUser.set(t.createdBy, e)
  }

  const students = rows.map((u) => ({
    id: u.id, email: u.email, nickname: u.nickname, disabled: u.disabled, createdAt: u.createdAt,
    taskCount: byUser.get(u.id)?.total ?? 0, doneCount: byUser.get(u.id)?.done ?? 0,
  }))
  return NextResponse.json({ stats: { totalStudents, todayNew, totalTasks, totalExported }, students, total })
})
