import { NextResponse } from 'next/server'
import { prisma, enqueueGen, setGenerationStatus } from '@mixcut/db'
import { requireRole, HttpError } from '@/lib/auth'
import { handler } from '@/lib/api'

// 重新对齐：改字幕文案后需重跑配音+对齐。批量保存后前端调用一次，
// 置回 TTS_GENERATING 并从 generate-tts 起（tts→align→ASSET_READY）。
export const POST = handler(async (_req, { params }) => {
  const session = await requireRole('operator')
  const task = await prisma.generationTask.findUnique({ where: { id: params.id } })
  if (!task || task.createdBy !== session.userId) throw new HttpError(404, '生成任务不存在')
  if (task.status !== 'ASSET_READY') throw new HttpError(400, '仅在素材就绪（ASSET_READY）时可重新对齐')
  await setGenerationStatus(task.id, 'TTS_GENERATING')
  await enqueueGen('generate-tts', { genTaskId: task.id })
  return NextResponse.json({ ok: true })
})
