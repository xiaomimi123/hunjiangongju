import { prisma } from './client'
import { canTransition } from './pipeline'

export async function transitionTask(taskId: string, to: string, note?: string): Promise<void> {
  const task = await prisma.task.findUniqueOrThrow({ where: { id: taskId } })
  if (!canTransition(task.status, to)) {
    throw new Error(`invalid transition ${task.status} -> ${to}`)
  }
  await prisma.$transaction([
    prisma.task.update({ where: { id: taskId }, data: { status: to } }),
    prisma.taskStatusLog.create({
      data: { taskId, fromStatus: task.status, toStatus: to, note },
    }),
  ])
}
