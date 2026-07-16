import { NextResponse } from 'next/server'
import { prisma, enqueueGen, setGenerationStatus } from '@mixcut/db'
import { requireRole, HttpError } from '@/lib/auth'
import { handler } from '@/lib/api'

// 单段重生：把该段 image_url 置空，回退到 IMAGE_GENERATING 并重跑文生图。
// generate-image 会重渲全部段并继续 TTS→对齐 回到 ASSET_READY（最简正确实现，
// 图/音/对齐都是 mock 幂等，重跑代价可接受；scoped-单段渲染留后续优化）。
export const POST = handler(async (_req, { params }) => {
  const session = await requireRole('operator')
  const task = await prisma.generationTask.findUnique({ where: { id: params.id } })
  if (!task || task.createdBy !== session.userId) throw new HttpError(404, '生成任务不存在')
  if (task.status !== 'ASSET_READY') throw new HttpError(400, '仅在素材就绪（ASSET_READY）时可重新生成分段')
  const seqNo = Number(params.segNo)
  if (!Number.isInteger(seqNo)) throw new HttpError(400, '分段序号无效')
  const seg = await prisma.generatedSegment.findFirst({ where: { generationTaskId: task.id, seqNo } })
  if (!seg) throw new HttpError(404, '分段不存在')
  await prisma.generatedSegment.update({ where: { id: seg.id }, data: { imageUrl: null } })
  await setGenerationStatus(task.id, 'IMAGE_GENERATING')
  await enqueueGen('generate-image', { genTaskId: task.id })
  return NextResponse.json({ ok: true })
})
