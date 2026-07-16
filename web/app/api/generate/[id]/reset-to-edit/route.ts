import { NextResponse } from 'next/server'
import { prisma, setGenerationStatus } from '@mixcut/db'
import { requireRole, HttpError } from '@/lib/auth'
import { handler } from '@/lib/api'

// 失败后退回编辑：render 起步即把 genTask 移入 VISUAL_RENDERING 且无回退路径，
// 若最新 RenderTask 停在 QC_FAILED/FAILED（或 genTask FAILED），运营将卡死无法重试。
// 此处仅在失败态允许退回 ASSET_READY（已生成的分段/图片/音频完好，可重新编辑再合成）。
const FAILED_RENDER = ['QC_FAILED', 'FAILED']

export const POST = handler(async (_req, { params }) => {
  const session = await requireRole('operator')
  const task = await prisma.generationTask.findUnique({ where: { id: params.id } })
  if (!task || task.createdBy !== session.userId) throw new HttpError(404, '生成任务不存在')

  const rt = await prisma.renderTask.findFirst({
    where: { generationTaskId: task.id },
    orderBy: { createdAt: 'desc' },
  })
  const canReset = task.status === 'FAILED' || (!!rt && FAILED_RENDER.includes(rt.status))
  if (!canReset) throw new HttpError(400, '当前状态不可退回编辑')

  await setGenerationStatus(task.id, 'ASSET_READY')
  return NextResponse.json({ ok: true })
})
