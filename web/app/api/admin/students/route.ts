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
    prisma.task.count(),
    prisma.task.count({ where: { status: 'EXPORTED' } }),
    prisma.user.findMany({
      where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * pageSize, take: pageSize,
      select: { id: true, email: true, nickname: true, disabled: true, createdAt: true, tasks: { select: { status: true } } },
    }),
  ])

  const students = rows.map((u) => ({
    id: u.id, email: u.email, nickname: u.nickname, disabled: u.disabled, createdAt: u.createdAt,
    taskCount: u.tasks.length, doneCount: u.tasks.filter((t) => t.status === 'EXPORTED').length,
  }))
  return NextResponse.json({ stats: { totalStudents, todayNew, totalTasks, totalExported }, students, total })
})
