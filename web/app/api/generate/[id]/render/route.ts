import { NextResponse } from 'next/server'
import { prisma, enqueueGen, setGenerationStatus } from '@mixcut/db'
import { requireRole, HttpError } from '@/lib/auth'
import { handler } from '@/lib/api'

// 确认合成：仅在 ASSET_READY 时允许，交给 render-visuals（该 job 创建 RenderTask）。
export const POST = handler(async (_req, { params }) => {
  const session = await requireRole('operator')
  const task = await prisma.generationTask.findUnique({ where: { id: params.id } })
  if (!task || task.createdBy !== session.userId) throw new HttpError(404, '生成任务不存在')
  if (task.status !== 'ASSET_READY') throw new HttpError(400, '仅在素材就绪（ASSET_READY）时可确认合成')
  // 先原子地把任务移出 ASSET_READY，再入队，避免重复点击重复合成（第二次点击命中上面的 400）。
  await setGenerationStatus(task.id, 'VISUAL_RENDERING')
  await enqueueGen('render-visuals', { genTaskId: task.id })
  return NextResponse.json({ ok: true })
})
