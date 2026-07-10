import { NextResponse } from 'next/server'
import { prisma } from '@mixcut/db'
import { requireRole } from '@/lib/auth'
import { handler } from '@/lib/api'

export const GET = handler(async (req) => {
  await requireRole('operator')
  const url = new URL(req.url)
  const search = (url.searchParams.get('search') ?? '').trim()
  const page = Math.max(1, Number(url.searchParams.get('page') ?? 1))
  const pageSize = Math.min(50, Math.max(1, Number(url.searchParams.get('pageSize') ?? 20)))

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
      select: { id: true, email: true, nickname: true, createdAt: true, tasks: { select: { status: true } } },
    }),
  ])

  const students = rows.map((u) => ({
    id: u.id, email: u.email, nickname: u.nickname, createdAt: u.createdAt,
    taskCount: u.tasks.length, doneCount: u.tasks.filter((t) => t.status === 'EXPORTED').length,
  }))
  return NextResponse.json({ stats: { totalStudents, todayNew, totalTasks, totalExported }, students, total })
})
