import { prisma, transitionTask, enqueue, splitScript } from '@mixcut/db'

export async function segmentScript(taskId: string): Promise<void> {
  const task = await prisma.task.findUniqueOrThrow({
    where: { id: taskId },
    include: { script: { include: { segments: { orderBy: { seqNo: 'asc' } } } } },
  })
  await transitionTask(taskId, 'SEGMENTING', '开始脚本分段')
  if (!task.script) throw new Error('任务没有关联文案')

  let segments = task.script.segments
  if (segments.length === 0) {
    const parts = splitScript(task.script.content)
    await prisma.scriptSegment.createMany({
      data: parts.map((text, i) => ({ scriptId: task.script!.id, seqNo: i + 1, text })),
    })
    segments = await prisma.scriptSegment.findMany({
      where: { scriptId: task.script.id }, orderBy: { seqNo: 'asc' },
    })
  }

  await prisma.$transaction([
    prisma.taskSegment.deleteMany({ where: { taskId } }),
    prisma.taskSegment.createMany({
      data: segments.map((s) => ({
        taskId, segmentId: s.id, orderNo: s.seqNo, subtitleText: s.text,
      })),
    }),
  ])
  await transitionTask(taskId, 'MATCHING', `分段完成，共 ${segments.length} 段`)
  await enqueue('match-materials', taskId)
}
