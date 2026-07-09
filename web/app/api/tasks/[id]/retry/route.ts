import { NextResponse } from 'next/server'
import { enqueue } from '@mixcut/db'
import { requireRole, HttpError } from '@/lib/auth'
import { handler } from '@/lib/api'
import { loadTaskFor } from '@/lib/taskGuard'

export const POST = handler(async (_req, { params }) => {
  const session = await requireRole()
  const task = await loadTaskFor(session, params.id)
  if (task.status !== 'FAILED') throw new HttpError(409, '仅失败任务可重试')
  await enqueue('segment-script', params.id)
  return NextResponse.json({ ok: true })
})
