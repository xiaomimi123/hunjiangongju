import { NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { prisma } from '@mixcut/db'
import { requireRole, HttpError } from '@/lib/auth'
import type { Session } from '@/lib/jwt'
import { handler } from '@/lib/api'
import { assertPassword } from '@/lib/security'

// 取该用户（校验存在且为 student 或 operator），其余角色一律 404，避免误操作
async function getUser(id: string) {
  const u = await prisma.user.findUnique({ where: { id } })
  if (!u || (u.role !== 'student' && u.role !== 'operator')) throw new HttpError(404, '账号不存在')
  return u
}

// 运营账号防锁死：不能操作自己；禁用/删除时必须保留至少一名其它可用运营
async function guardOperator(session: Session, targetId: string, requireRemaining: boolean) {
  if (targetId === session.userId) throw new HttpError(400, '不能操作自己')
  if (requireRemaining) {
    const remaining = await prisma.user.count({ where: { role: 'operator', disabled: false, id: { not: targetId } } })
    if (remaining === 0) throw new HttpError(400, '至少保留一名可用运营')
  }
}

// 学员作品列表（学员自助生成的任务）
export const GET = handler(async (_req, { params }) => {
  await requireRole('operator')
  await getUser(params.id)
  const tasks = await prisma.generationTask.findMany({
    where: { createdBy: params.id },
    orderBy: { createdAt: 'desc' },
    select: { id: true, status: true, subject: true, createdAt: true, framework: { select: { name: true } } },
  })
  return NextResponse.json({ tasks })
})

// 删除账号（学员：连同其生成任务；运营：受防锁死保护）
export const DELETE = handler(async (_req, { params }) => {
  const session = await requireRole('operator')
  const u = await getUser(params.id)
  if (u.role === 'operator') {
    await guardOperator(session, params.id, true)
    await prisma.user.delete({ where: { id: params.id } })
    return NextResponse.json({ ok: true })
  }
  await prisma.$transaction([
    prisma.generationTask.deleteMany({ where: { createdBy: params.id } }),
    prisma.user.delete({ where: { id: params.id } }),
  ])
  return NextResponse.json({ ok: true })
})

// 管理操作：重置密码 / 禁用 / 启用
export const PATCH = handler(async (req, { params }) => {
  const session = await requireRole('operator')
  const u = await getUser(params.id)
  const { action, password, amount } = await req.json()
  if (u.role === 'operator') await guardOperator(session, params.id, action === 'disable')
  if (action === 'reset') {
    assertPassword(password)
    await prisma.user.update({ where: { id: params.id }, data: { passwordHash: await bcrypt.hash(password, 10) } })
  } else if (action === 'disable' || action === 'enable') {
    await prisma.user.update({ where: { id: params.id }, data: { disabled: action === 'disable' } })
  } else if (action === 'recharge') {
    // 积分充值：导师线下收款后在这里落账。加分与流水同一事务，对账不缺笔
    if (!Number.isInteger(amount) || amount < 1 || amount > 100000) {
      throw new HttpError(400, '充值积分须为 1~100000 的整数')
    }
    await prisma.$transaction([
      prisma.user.update({ where: { id: params.id }, data: { credits: { increment: amount } } }),
      prisma.creditLog.create({ data: { userId: params.id, delta: amount, reason: 'recharge', operatorId: session.userId } }),
    ])
  } else {
    throw new HttpError(400, '未知操作')
  }
  return NextResponse.json({ ok: true })
})
