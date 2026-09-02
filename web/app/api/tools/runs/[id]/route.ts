// 学员端：单条运行记录详情。只能看自己的；运营可看全部（用于排查/客服）。
// 非本人的 run 返回 404 而非 403——避免向学员泄漏"这个 id 存在，只是不是你的"。
import { NextResponse } from 'next/server'
import { prisma } from '@mixcut/db'
import { requireRole, HttpError } from '@/lib/auth'
import { handler } from '@/lib/api'

export const GET = handler(async (_req, { params }) => {
  const s = await requireRole()
  // 404 判断需要 userId，先按主键查全字段拿 userId 做归属判断，再决定要不要按收窄字段重查一遍——
  // 简单起见：直接 select 收窄字段 + userId（userId 只用来判权限，不进响应体）。
  const run = await prisma.cozeToolRun.findUnique({
    where: { id: params.id },
    // 收窄字段：不给 inputs/outputRaw——outputRaw 是扣子原始响应整包，可能含 debug_url
    // 之类带 workflow_id 的字段，学员端不该看到。
    select: {
      id: true, toolId: true, userId: true, status: true, errorMsg: true,
      creditsCost: true, outputItems: true, createdAt: true, finishedAt: true,
    },
  })
  if (!run || (s.role !== 'operator' && run.userId !== s.userId)) {
    throw new HttpError(404, '记录不存在')
  }
  const { userId: _userId, ...safe } = run
  return NextResponse.json(safe)
})
