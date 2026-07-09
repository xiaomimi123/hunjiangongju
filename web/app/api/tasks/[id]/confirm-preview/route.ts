import { NextResponse } from 'next/server'
import { transitionTask, enqueue } from '@mixcut/db'
import { requireRole, HttpError } from '@/lib/auth'
import { handler } from '@/lib/api'
import { loadTaskFor } from '@/lib/taskGuard'

export const POST = handler(async (_req, { params }) => {
  const session = await requireRole()
  const task = await loadTaskFor(session, params.id)
  if (task.status !== 'PREVIEW_PENDING') throw new HttpError(409, '当前状态不允许确认预览')
  await transitionTask(params.id, 'QC_RUNNING', '预览确认，进入质检')
  await enqueue('run-qc', params.id)
  return NextResponse.json({ ok: true })
})
