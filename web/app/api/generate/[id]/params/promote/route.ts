import { NextResponse } from 'next/server'
import type { Prisma } from '@prisma/client'
import { prisma, mergeTemplateParamsRaw, readTaskParamsOverride, TASK_PARAMS_KEY } from '@mixcut/db'
import { requireRole, HttpError } from '@/lib/auth'
import { handler } from '@/lib/api'
import { canAccessTask } from '@/lib/taskAccess'

// 「保存为模板默认值」：把本条任务调好的参数合并进框架，以后同框架的片子都按新的来，
// 然后清掉任务上的覆盖（否则同一份值存两处，框架以后再改就带不动这条任务了）。
export const POST = handler(async (_req, { params }) => {
  const session = await requireRole('operator')
  const task = await prisma.generationTask.findUnique({
    where: { id: params.id },
    include: { framework: { select: { id: true, overlayTemplate: true } } },
  })
  if (!canAccessTask(task, session)) throw new HttpError(404, '生成任务不存在')

  const override = readTaskParamsOverride(task.variables)
  if (!override) throw new HttpError(400, '这条任务没有改过参数，没什么可保存的')

  const ot = (task.framework.overlayTemplate && typeof task.framework.overlayTemplate === 'object'
    && !Array.isArray(task.framework.overlayTemplate)
    ? { ...(task.framework.overlayTemplate as Record<string, unknown>) }
    : {}) as Record<string, unknown>
  ot.__templateParams = mergeTemplateParamsRaw(ot.__templateParams, override)

  const vars = (task.variables && typeof task.variables === 'object' && !Array.isArray(task.variables)
    ? { ...(task.variables as Record<string, unknown>) }
    : {}) as Record<string, unknown>
  delete vars[TASK_PARAMS_KEY]

  // 两条写在同一个事务里：框架写成功而任务覆盖没清掉的话，同一份值会存两处，
  // 之后改框架带不动这条任务，排查时看到的是"改了框架没生效"。
  await prisma.$transaction([
    prisma.copyFramework.update({ where: { id: task.framework.id }, data: { overlayTemplate: ot as Prisma.InputJsonValue } }),
    prisma.generationTask.update({ where: { id: task.id }, data: { variables: vars as Prisma.InputJsonValue } }),
  ])
  return NextResponse.json({ ok: true })
})
