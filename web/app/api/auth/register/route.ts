import { NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { prisma } from '@mixcut/db'
import { requireRole, HttpError } from '@/lib/auth'
import { handler } from '@/lib/api'

export const POST = handler(async (req) => {
  await requireRole('operator')
  const { account, password, role } = await req.json()
  if (!account || !password) throw new HttpError(400, '请填写账号和密码')
  if (role !== 'student' && role !== 'operator') throw new HttpError(400, 'role 须为 student 或 operator')
  const exists = await prisma.user.findUnique({ where: { account } })
  if (exists) throw new HttpError(409, '账号已存在')
  const user = await prisma.user.create({
    data: { account, passwordHash: await bcrypt.hash(password, 10), role },
  })
  return NextResponse.json({ id: user.id, account: user.account, role: user.role })
})
