// 学员端：可用的扣子工具列表。只列已上架的，且字段收窄——学员不需要知道 workflowId。
import { NextResponse } from 'next/server'
import { prisma } from '@mixcut/db'
import { requireRole } from '@/lib/auth'
import { handler } from '@/lib/api'

export const GET = handler(async () => {
  await requireRole()
  const tools = await prisma.cozeTool.findMany({
    where: { enabled: true },
    orderBy: { sortOrder: 'asc' },
    select: { id: true, name: true, description: true, priceCredits: true, inputs: true, demoVideoUrl: true, tutorialVideoUrl: true },
  })
  // fixed（固定值）项整个剥掉：value 里可能是第三方 api key 这类敏感值，学员端一个字节都不能见
  const sanitized = tools.map((t) => ({
    ...t,
    inputs: Array.isArray(t.inputs)
      ? (t.inputs as { type?: string }[]).filter((i) => i?.type !== 'fixed')
      : t.inputs,
  }))
  return NextResponse.json({ tools: sanitized })
})
