import { NextResponse } from 'next/server'
import { prisma, setGenerationStatus } from '@mixcut/db'
import { requireRole, HttpError } from '@/lib/auth'
import { handler } from '@/lib/api'
import { canAccessTask } from '@/lib/taskAccess'

// 退回编辑：把 genTask 移回 ASSET_READY，让运营能重新编辑再合成
//（已生成的分段/图片/音频完好，不重跑文案/配图/配音）。
//
// 原本只在**失败态**开放：render 起步即把 genTask 移入 VISUAL_RENDERING 且无回退路径，
// 最新 RenderTask 停在 QC_FAILED/FAILED 时运营会卡死无法重试。
//
// 剪辑工作台需要更宽的窗口：**渲完、未发布之前**都要能回头改（用户拍板的口径）。
// 已发布的仍然锁死——要改先取消发布，避免线上片子被无声无息地换掉。
const FAILED_RENDER = ['QC_FAILED', 'FAILED']
/** 成片已经产出、还没发布 → 允许回头改 */
const RENDERED_OK = ['PREVIEW_PENDING', 'QC_RUNNING', 'QC_PASSED', 'EXPORTED']

export const POST = handler(async (_req, { params }) => {
  const session = await requireRole('operator')
  const task = await prisma.generationTask.findUnique({ where: { id: params.id } })
  if (!canAccessTask(task, session)) throw new HttpError(404, '生成任务不存在')

  const rt = await prisma.renderTask.findFirst({
    where: { generationTaskId: task.id },
    orderBy: { createdAt: 'desc' },
  })
  if (task.published) throw new HttpError(400, '已发布的成片不可退回编辑，请先取消发布')
  const canReset = task.status === 'FAILED'
    || (!!rt && (FAILED_RENDER.includes(rt.status) || RENDERED_OK.includes(rt.status)))
  if (!canReset) throw new HttpError(400, '当前状态不可退回编辑')

  await setGenerationStatus(task.id, 'ASSET_READY')
  return NextResponse.json({ ok: true })
})
