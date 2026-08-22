import { NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { prisma } from '@mixcut/db'
import { requireRole, HttpError } from '@/lib/auth'
import { isPhoneAccount } from '@/lib/security'
import { handler } from '@/lib/api'
import { assertPassword } from '@/lib/security'

export const GET = handler(async (req) => {
  await requireRole('operator')
  const url = new URL(req.url)
  const role = url.searchParams.get('role') === 'operator' ? 'operator' : 'student'
  const search = (url.searchParams.get('search') ?? '').trim()
  // ?? 默认值处理"参数缺失"（get() 返回 null → Number(null)=0 会误判为有效），Number.isFinite 处理"非数字"
  const pageRaw = Number(url.searchParams.get('page') ?? 1)
  const page = Number.isFinite(pageRaw) ? Math.max(1, Math.trunc(pageRaw)) : 1
  const pageSizeRaw = Number(url.searchParams.get('pageSize') ?? 20)
  const pageSize = Number.isFinite(pageSizeRaw) ? Math.min(50, Math.max(1, Math.trunc(pageSizeRaw))) : 20

  const where = {
    role,
    ...(search ? { OR: [{ email: { contains: search, mode: 'insensitive' as const } }, { nickname: { contains: search, mode: 'insensitive' as const } }] } : {}),
  }

  const startOfToday = new Date(); startOfToday.setHours(0, 0, 0, 0)
  const [total, totalStudents, todayNew, totalTasks, totalExported, rows] = await Promise.all([
    prisma.user.count({ where }),
    prisma.user.count({ where: { role } }),
    prisma.user.count({ where: { role, createdAt: { gte: startOfToday } } }),
    role === 'student' ? prisma.generationTask.count() : Promise.resolve(0),
    role === 'student' ? prisma.generationTask.count({ where: { status: 'EXPORTED' } }) : Promise.resolve(0),
    prisma.user.findMany({
      where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * pageSize, take: pageSize,
      select: { id: true, email: true, nickname: true, disabled: true, createdAt: true, genLimit: true, genUsed: true, genUsedDate: true },
    }),
  ])

  // 学员作品 = 该学员发起的生成任务（generationTask.createdBy 为普通字段，非关系，用聚合统计）；运营账号不统计作品
  const ids = role === 'student' ? rows.map((u) => u.id) : []
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

  // genUsed 对外语义是「今日已用」：跨天后计数还留着旧值，但日期不是今天就按 0 报
  //（真正的归零发生在学员下一次生成时，见 /api/generate 的跨天分支）
  const today = new Date(new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10))
  const students = rows.map((u) => ({
    id: u.id, email: u.email, nickname: u.nickname, disabled: u.disabled, createdAt: u.createdAt,
    genLimit: u.genLimit,
    genUsed: u.genUsedDate?.getTime() === today.getTime() ? u.genUsed : 0,
    taskCount: byUser.get(u.id)?.total ?? 0, doneCount: byUser.get(u.id)?.done ?? 0,
  }))
  return NextResponse.json({ stats: { totalStudents, todayNew, totalTasks, totalExported }, students, total })
})

// 新增账号（学员或运营）
export const POST = handler(async (req) => {
  await requireRole('operator')
  const { email, nickname, password, role } = await req.json()
  const em = String(email ?? '').trim().toLowerCase()
  if (role !== 'student' && role !== 'operator') throw new HttpError(400, '角色只能是学员或运营')
  // 账号体系（用户拍板）：学员一律 11 位手机号；运营保留邮箱（管理员由 ADMIN_EMAIL 初始化）
  // 或同样用手机号。users.email 列当「账号」用，列名是历史遗留。
  if (role === 'student') {
    if (!isPhoneAccount(em)) throw new HttpError(400, '学员账号须为 11 位手机号')
  } else if (!isPhoneAccount(em) && !/^\S+@\S+\.\S+$/.test(em)) {
    throw new HttpError(400, '运营账号须为 11 位手机号或邮箱')
  }
  assertPassword(password)
  if (await prisma.user.findUnique({ where: { email: em } })) throw new HttpError(409, '该账号已存在')
  try {
    const u = await prisma.user.create({
      data: { email: em, nickname: String(nickname ?? '').trim() || null, passwordHash: await bcrypt.hash(password, 10), role },
      select: { id: true, email: true, role: true },
    })
    return NextResponse.json(u, { status: 201 })
  } catch (e) {
    if (e && typeof e === 'object' && (e as { code?: string }).code === 'P2002') throw new HttpError(409, '该账号已存在')
    throw e
  }
})
