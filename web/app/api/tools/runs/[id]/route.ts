// 学员端：单条运行记录详情。只能看自己的；运营可看全部（用于排查/客服）。
// 非本人的 run 返回 404 而非 403——避免向学员泄漏"这个 id 存在，只是不是你的"。
import { NextResponse } from 'next/server'
import { prisma } from '@mixcut/db'
import { requireRole, HttpError } from '@/lib/auth'
import { handler } from '@/lib/api'

export const GET = handler(async (_req, { params }) => {
  const s = await requireRole()
  const run = await prisma.cozeToolRun.findUnique({ where: { id: params.id } })
  if (!run || (s.role !== 'operator' && run.userId !== s.userId)) {
    throw new HttpError(404, '记录不存在')
  }
  return NextResponse.json(run)
})
