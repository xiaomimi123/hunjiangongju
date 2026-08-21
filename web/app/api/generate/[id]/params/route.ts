import { NextResponse } from 'next/server'
import type { Prisma } from '@prisma/client'
import { prisma, sanitizeParamsOverride, mergeTemplateParamsRaw, readTaskParamsOverride, resolveTemplateParamsRaw, parseTemplateParams, TASK_PARAMS_KEY } from '@mixcut/db'
import { requireRole, HttpError } from '@/lib/auth'
import { handler } from '@/lib/api'
import { canAccessTask } from '@/lib/taskAccess'
import { studioBlockReason } from '@/lib/studioWindow'

// 剪辑工作台：本条任务的模板参数覆盖。
//
// 参数原本只挂在**框架**上（overlayTemplate.__templateParams），同框架的片子共用一份，
// 想「就这一条改一下」只能改框架、波及以后所有片子。这里把覆盖存进
// variables.__templateParams —— 与 BGM 的 variables.__bgmId 同一套做法，不给表加列。
//
// 渲染侧由 resolveTemplateParamsRaw 深合并（renderVisuals + renderVideo 两处都读）。

async function loadTask(id: string, session: { userId: string; role: string }) {
  const task = await prisma.generationTask.findUnique({
    where: { id },
    include: { renderTasks: { orderBy: { createdAt: 'desc' }, take: 1, select: { status: true } } },
  })
  if (!canAccessTask(task, session)) throw new HttpError(404, '生成任务不存在')
  const blocked = studioBlockReason(task)
  if (blocked) throw new HttpError(400, blocked)
  return task
}

function writeVars(vars: unknown, next: Record<string, unknown> | null): Prisma.InputJsonValue {
  const v = (vars && typeof vars === 'object' && !Array.isArray(vars)
    ? { ...(vars as Record<string, unknown>) }
    : {}) as Record<string, unknown>
  if (next) v[TASK_PARAMS_KEY] = next
  else delete v[TASK_PARAMS_KEY]
  return v as Prisma.InputJsonValue
}

/**
 * 工作台打开时读一次：**合并后的有效参数** + 当前覆盖 + 各段实际起止。
 *
 * 为什么不复用详情接口：那里只给 variables（原始覆盖），而工作台要显示的是
 * 「这条片子现在实际按什么参数在渲」——即框架那份合并覆盖之后的结果。
 * 让前端自己去合并等于把 mergeTemplateParamsRaw 的语义抄一份到浏览器里，
 * 两份实现迟早漂移。
 *
 * bodyTimings 一并给出：**画面各段的起止取自它，不是取自 body.slotDurationsMs**
 *（renderVisuals.ts:66-69）。工作台的节奏编辑要拿它当当前值显示，
 * 并据此提示「改了要重新配音对齐才生效」。
 */
export const GET = handler(async (_req, { params }) => {
  const session = await requireRole('operator')
  const task = await prisma.generationTask.findUnique({
    where: { id: params.id },
    include: {
      framework: { select: { name: true, overlayTemplate: true } },
      renderTasks: { orderBy: { createdAt: 'desc' }, take: 1, select: { status: true } },
    },
  })
  if (!canAccessTask(task, session)) throw new HttpError(404, '生成任务不存在')
  const effective = parseTemplateParams(resolveTemplateParamsRaw(task.framework.overlayTemplate, task.variables))
  return NextResponse.json({
    effective,
    override: readTaskParamsOverride(task.variables),
    bodyTimings: Array.isArray(task.bodyTimings) ? task.bodyTimings : [],
    frameworkName: task.framework.name,
    published: task.published,
    // 不可编辑时给出原因，前端据此禁用保存并把话说清楚
    blockReason: studioBlockReason(task),
  })
})

/**
 * 保存覆盖。请求体是**局部** TemplateParams，只写想改的字段。
 * 与已有的覆盖再合并一次——工作台是分区保存的（节奏/字幕/配乐各存各的），
 * 整份替换会让先保存的分区被后保存的抹掉。
 */
export const PATCH = handler(async (req, { params }) => {
  const session = await requireRole('operator')
  const task = await loadTask(params.id, session)
  const body = await req.json().catch(() => {
    throw new HttpError(400, '请求体格式错误')
  })
  const clean = sanitizeParamsOverride(body)
  if (!clean) throw new HttpError(400, '没有可保存的参数（字段名不对，或值都不合法）')
  const merged = mergeTemplateParamsRaw(readTaskParamsOverride(task.variables) ?? {}, clean)
  await prisma.generationTask.update({ where: { id: task.id }, data: { variables: writeVars(task.variables, merged) } })
  return NextResponse.json({ ok: true, params: merged })
})

/** 清除覆盖，回到框架默认 */
export const DELETE = handler(async (_req, { params }) => {
  const session = await requireRole('operator')
  const task = await loadTask(params.id, session)
  await prisma.generationTask.update({ where: { id: task.id }, data: { variables: writeVars(task.variables, null) } })
  return NextResponse.json({ ok: true })
})
