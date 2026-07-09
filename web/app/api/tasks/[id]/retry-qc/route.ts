import { NextResponse } from 'next/server'
import { transitionTask, enqueue } from '@mixcut/db'
import { requireRole, HttpError } from '@/lib/auth'
import { handler } from '@/lib/api'
import { loadTaskFor } from '@/lib/taskGuard'

export const POST = handler(async (_req, { params }) => {
  const session = await requireRole()
  const task = await loadTaskFor(session, params.id)
  if (task.status !== 'QC_FAILED') throw new HttpError(409, '仅质检失败的任务可重新质检')
  await transitionTask(params.id, 'QC_RUNNING', '重新提交质检')
  await enqueue('run-qc', params.id)
  return NextResponse.json({ ok: true })
})
