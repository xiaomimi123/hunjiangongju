import { NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { prisma } from '@mixcut/db'
import { requireRole, HttpError } from '@/lib/auth'
import { handler } from '@/lib/api'
import { assertPassword } from '@/lib/security'

// 取该学员（校验存在且确为 student），非学员一律 404，避免误操作运营账号
async function getStudent(id: string) {
  const u = await prisma.user.findUnique({ where: { id } })
  if (!u || u.role !== 'student') throw new HttpError(404, '学员不存在')
  return u
}

// 学员作品列表
export const GET = handler(async (_req, { params }) => {
  await requireRole('operator')
  await getStudent(params.id)
  const tasks = await prisma.task.findMany({
    where: { userId: params.id },
    orderBy: { createdAt: 'desc' },
    select: { id: true, status: true, aspectRatio: true, createdAt: true, script: { select: { title: true } } },
  })
  return NextResponse.json({ tasks })
})

// 删除学员（连同其任务数据；任务子表已配置级联删除）
export const DELETE = handler(async (_req, { params }) => {
  await requireRole('operator')
  await getStudent(params.id)
  await prisma.$transaction([
    prisma.accessKey.deleteMany({ where: { userId: params.id } }),
    prisma.task.deleteMany({ where: { userId: params.id } }),
    prisma.user.delete({ where: { id: params.id } }),
  ])
  return NextResponse.json({ ok: true })
})

// 管理操作：重置密码 / 禁用 / 启用
export const PATCH = handler(async (req, { params }) => {
  await requireRole('operator')
  await getStudent(params.id)
  const { action, password } = await req.json()
  if (action === 'reset') {
    assertPassword(password)
    await prisma.user.update({ where: { id: params.id }, data: { passwordHash: await bcrypt.hash(password, 10) } })
  } else if (action === 'disable' || action === 'enable') {
    await prisma.user.update({ where: { id: params.id }, data: { disabled: action === 'disable' } })
  } else {
    throw new HttpError(400, '未知操作')
  }
  return NextResponse.json({ ok: true })
})
