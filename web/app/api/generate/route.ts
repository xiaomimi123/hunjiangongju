import { NextResponse } from 'next/server'
import type { Prisma } from '@prisma/client'
import { prisma, enqueueGen, readFrameworkVoices } from '@mixcut/db'
import { requireRole, HttpError } from '@/lib/auth'
import { handler } from '@/lib/api'
import { checkRate } from '@/lib/ratelimit'
import { normalizeVariables, restrictVoiceForNonOperator } from './normalize'

export const POST = handler(async (req) => {
  const s = await requireRole()
  // 选书步骤现在会为每次生成打出约 20 次联网检索(enableSearch)LLM 调用，成本比之前高一个数量级。
  // 只对学员等非运营角色限流：运营跑的是 studio 工作流，需要连续试参数，不该被学员端限额卡住。
  // 6 次/60s：留够正常操作中「改选题重试/切模板」的空间，同时把连点刷检索成本的上限锁在个位数量级。
  if (s.role !== 'operator') checkRate('generate', s.userId, 6)
  const { frameworkId, subject, variables } = await req.json().catch(() => {
    throw new HttpError(400, '请求体格式错误')
  })
  if (!frameworkId || typeof frameworkId !== 'string') throw new HttpError(400, '请选择框架')
  const fw = await prisma.copyFramework.findUnique({ where: { id: frameworkId } })
  if (!fw) throw new HttpError(400, '框架不存在')
  // 学员（非运营）：只能用已发布框架，自动串联渲染；运营：保留手工门禁
  let autoRender = false
  if (s.role !== 'operator') {
    if (!fw.published) throw new HttpError(403, '该框架未发布')
    autoRender = true
  }
  // 非运营（学员等）只能用**这个框架**开放的音色：不在名单里的一律剥离，
  // 防止盗用运营的私有/付费克隆音色。名单为空即维持"一律用默认音色"的老行为。
  const normalizedVariables = restrictVoiceForNonOperator(
    s.role,
    normalizeVariables(variables),
    readFrameworkVoices(fw.overlayTemplate).allowed,
  )
  const mode = normalizedVariables?.scriptMode
  let finalSubject = typeof subject === 'string' ? subject.trim() : ''
  if (mode === 'manual' || mode === 'imitate') {
    // 选题可空：用书名或文案首句兜底（满足非空约束、列表页可读）
    if (!finalSubject) {
      const bt = typeof normalizedVariables?.bookTitle === 'string' ? normalizedVariables.bookTitle : ''
      const cs = typeof normalizedVariables?.customScript === 'string' ? normalizedVariables.customScript : ''
      finalSubject = (bt || cs.split(/[。！？!?；;\n]/)[0] || '自定义文案').trim().slice(0, 40)
    }
  } else if (!finalSubject) {
    throw new HttpError(400, '选题不能为空')
  }
  if (normalizedVariables && typeof normalizedVariables.voiceId === 'string') {
    const voice = await prisma.clonedVoice.findUnique({ where: { voiceId: normalizedVariables.voiceId } })
    if (!voice) throw new HttpError(400, '所选音色不存在')
  }
  const task = await prisma.generationTask.create({
    data: {
      frameworkId,
      subject: finalSubject,
      variables: (normalizedVariables as Prisma.InputJsonValue | undefined) ?? undefined,
      status: 'SCRIPT_GENERATING',
      createdBy: s.userId,
      autoRender,
    },
  })
  await enqueueGen('select-books', { genTaskId: task.id })
  return NextResponse.json({ id: task.id })
})

// 运营列表的返回上限。运营看的是全量任务，随学员使用量增长会无界膨胀，故设上限；
// 但不做静默截断——命中上限时前端会提示「仅显示最近 N 条」，避免运营误以为看到了全部。
// 注意不要 export：Next.js route 文件只允许导出 GET/POST/dynamic 等约定名，
// 多导出一个常量会导致构建期类型校验失败（"does not match the required types of a Next.js Route"）。
const OPERATOR_LIST_LIMIT = 200

export const GET = handler(async () => {
  const s = await requireRole()
  // 学员只看自己的；运营看全部（含学员创建的）。此前无论角色一律按 createdBy 过滤，
  // 导致后台「生成栏」永远看不到学员的任务——任务在库里状态正常流转，后台却是空的。
  const isOperator = s.role === 'operator'
  const tasks = await prisma.generationTask.findMany({
    ...(isOperator ? {} : { where: { createdBy: s.userId } }),
    orderBy: { createdAt: 'desc' },
    ...(isOperator ? { take: OPERATOR_LIST_LIMIT } : {}),
    select: {
      id: true, subject: true, status: true, createdAt: true, updatedAt: true,
      ...(isOperator ? { createdBy: true } : {}),
      framework: { select: { name: true } },
      // 最新合成任务状态：autoRender 任务的 generationTask.status 停在 VISUAL_RENDERING，
      // 真实进度（EXPORTED/QC_FAILED 等）在 RenderTask 上，列表据此归类「已完成/失败」。
      renderTasks: { orderBy: { createdAt: 'desc' }, take: 1, select: { status: true } },
    },
  })
  if (!isOperator) return NextResponse.json(tasks)

  // GenerationTask.createdBy 是裸字符串、未与 User 建关联，故补一次批量查询把创建人补齐，
  // 让运营能分辨哪条是哪个学员生成的。不建外键关联是为了避免为此单独加一次数据库迁移。
  // 用 Array.from 而非展开 Set：本仓 tsconfig 的 target 下展开 Set 需要 downlevelIteration，
  // vitest 的转译能过、next build 会失败。
  const ids = Array.from(new Set(tasks.map((t) => t.createdBy).filter((v): v is string => !!v)))
  const users = ids.length
    ? await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, nickname: true, email: true, role: true } })
    : []
  const byId = new Map(users.map((u) => [u.id, u]))
  return NextResponse.json(
    tasks.map(({ createdBy, ...t }) => {
      const u = createdBy ? byId.get(createdBy) : undefined
      return { ...t, creator: u ? { nickname: u.nickname, email: u.email, role: u.role } : null }
    }),
  )
})
