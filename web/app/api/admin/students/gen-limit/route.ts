import { NextResponse } from 'next/server'
import { prisma } from '@mixcut/db'
import { requireRole, HttpError } from '@/lib/auth'
import { handler } from '@/lib/api'

// 一键给**全部学员**设生成额度。只动 genLimit，不碰 genUsed——
// 已用次数是事实记录，批量清零要么是误操作要么该走单人编辑（那里有 resetUsed）。
export const POST = handler(async (req) => {
  await requireRole('operator')
  const { limit } = await req.json().catch(() => {
    throw new HttpError(400, '请求体格式错误')
  })
  if (limit !== null && (!Number.isInteger(limit) || limit < 0 || limit > 100000)) {
    throw new HttpError(400, '额度须为 0~100000 的整数，或 null 表示不限')
  }
  const r = await prisma.user.updateMany({ where: { role: 'student' }, data: { genLimit: limit } })
  return NextResponse.json({ ok: true, updated: r.count })
})
