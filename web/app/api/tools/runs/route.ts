// 学员端：本人的扣子工具运行记录列表，倒序，取最近 50 条。
import { NextResponse } from 'next/server'
import { prisma } from '@mixcut/db'
import { requireRole } from '@/lib/auth'
import { handler } from '@/lib/api'

const PAGE_SIZE = 50

// 学员端不该看到 worker 写库的原始 errorMsg：那里面可能是扣子响应体前 300 字（含第三方细节）
// 或 fs 报错（含服务器绝对路径，如 ENOENT ... /data/coze-uploads/...）。admin 那边的运行记录
// 接口不做这层收口，运营需要看真错误去排查。
function sanitizeRun<T extends { status: string; errorMsg: string | null }>(run: T): T {
  if (run.status !== 'FAILED') return run
  return { ...run, errorMsg: '运行失败，积分已退回' }
}

export const GET = handler(async () => {
  const s = await requireRole()
  const runs = await prisma.cozeToolRun.findMany({
    where: { userId: s.userId },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: PAGE_SIZE,
    // 收窄字段：不给 outputRaw——扣子原始响应整包，可能含 debug_url 之类带 workflow_id 的字段，
    // 学员端不该看到。inputs 本人数据、无越权面，加回来给成片库拼「工具名+输入摘要」用。
    select: {
      id: true, toolId: true, status: true, errorMsg: true, inputs: true,
      creditsCost: true, outputItems: true, createdAt: true, finishedAt: true,
    },
  })
  return NextResponse.json({ runs: s.role === 'operator' ? runs : runs.map(sanitizeRun) })
})
