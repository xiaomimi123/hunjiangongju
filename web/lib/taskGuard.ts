import { prisma } from '@mixcut/db'
import { HttpError } from './auth'
import type { Session } from './jwt'

export async function loadTaskFor(session: Session, id: string) {
  const task = await prisma.task.findUnique({ where: { id } })
  if (!task) throw new HttpError(404, '任务不存在')
  if (session.role !== 'operator' && task.userId !== session.userId) {
    throw new HttpError(403, '无权访问该任务')
  }
  return task
}
