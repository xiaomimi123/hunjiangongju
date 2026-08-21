import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest'
import { NextRequest } from 'next/server'
import { prisma, TASK_PARAMS_KEY } from '@mixcut/db'

const requireRoleMock = vi.fn()
vi.mock('@/lib/auth', async () => {
  const actual = await vi.importActual<typeof import('@/lib/auth')>('@/lib/auth')
  return { ...actual, requireRole: (...args: unknown[]) => requireRoleMock(...args) }
})

const { PATCH, DELETE } = await import('./route')
const { POST: PROMOTE } = await import('./promote/route')

const frameworkIds: string[] = []
const taskIds: string[] = []

afterAll(async () => {
  await prisma.renderTask.deleteMany({ where: { generationTaskId: { in: taskIds } } })
  await prisma.generationTask.deleteMany({ where: { id: { in: taskIds } } })
  await prisma.copyFramework.deleteMany({ where: { id: { in: frameworkIds } } })
  await prisma.$disconnect()
})

async function makeFramework(overlayTemplate?: unknown) {
  const fw = await prisma.copyFramework.create({
    data: { frameworkText: 'T', overlayTemplate: (overlayTemplate ?? undefined) as never },
  })
  frameworkIds.push(fw.id)
  return fw
}

/** 造一条「已渲完、未发布」的任务——工作台的主场景 */
async function makeTask(opts: {
  frameworkId: string
  variables?: unknown
  published?: boolean
  renderStatus?: string | null
  status?: string
}) {
  const task = await prisma.generationTask.create({
    data: {
      subject: '测试', frameworkId: opts.frameworkId, createdBy: 'op1',
      status: opts.status ?? 'VISUAL_RENDERING',
      published: opts.published ?? false,
      variables: (opts.variables ?? undefined) as never,
    },
  })
  taskIds.push(task.id)
  if (opts.renderStatus !== null) {
    await prisma.renderTask.create({
      data: { generationTaskId: task.id, status: opts.renderStatus ?? 'EXPORTED' },
    })
  }
  return task
}

const req = (id: string, body?: unknown) =>
  new NextRequest(`http://localhost/api/generate/${id}/params`, {
    method: 'POST',
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })

const ctx = (id: string) => ({ params: { id } })

async function readOverride(id: string) {
  const t = await prisma.generationTask.findUniqueOrThrow({ where: { id } })
  return (t.variables as Record<string, unknown> | null)?.[TASK_PARAMS_KEY]
}

beforeEach(() => {
  requireRoleMock.mockReset()
  requireRoleMock.mockResolvedValue({ userId: 'op1', role: 'operator' })
})

describe('PATCH /api/generate/[id]/params', () => {
  it('保存覆盖到 variables 的保留键', async () => {
    const fw = await makeFramework()
    const t = await makeTask({ frameworkId: fw.id })
    const r = await PATCH(req(t.id, { audio: { bgmVolume: 0.4 } }), ctx(t.id))
    expect(r.status).toBe(200)
    expect(await readOverride(t.id)).toEqual({ audio: { bgmVolume: 0.4 } })
  })

  // ★ 工作台是**分区保存**的（节奏/字幕/配乐各存各的）。
  // 整份替换会让先保存的分区被后保存的抹掉——运营调完节奏再调配乐，节奏就没了。
  it('与已有覆盖合并，不整份替换', async () => {
    const fw = await makeFramework()
    const t = await makeTask({ frameworkId: fw.id, variables: { [TASK_PARAMS_KEY]: { body: { slotDurationsMs: [5000] } } } })
    await PATCH(req(t.id, { audio: { bgmVolume: 0.4 } }), ctx(t.id))
    expect(await readOverride(t.id)).toEqual({ body: { slotDurationsMs: [5000] }, audio: { bgmVolume: 0.4 } })
  })

  it('保留 variables 里的其它键（books / __bgmId 不能被踩掉）', async () => {
    const fw = await makeFramework()
    const t = await makeTask({ frameworkId: fw.id, variables: { __bgmId: 'b1', books: [{ title: '活着' }] } })
    await PATCH(req(t.id, { audio: { bgmVolume: 0.4 } }), ctx(t.id))
    const v = (await prisma.generationTask.findUniqueOrThrow({ where: { id: t.id } })).variables as Record<string, unknown>
    expect(v.__bgmId).toBe('b1')
    expect(v.books).toEqual([{ title: '活着' }])
  })

  it('白名单一个都没命中 → 400，且不写库', async () => {
    const fw = await makeFramework()
    const t = await makeTask({ frameworkId: fw.id })
    expect((await PATCH(req(t.id, { body: { kenBurns: 'off' } }), ctx(t.id))).status).toBe(400)
    expect(await readOverride(t.id)).toBeUndefined()
  })

  it('请求体不是 JSON → 400', async () => {
    const fw = await makeFramework()
    const t = await makeTask({ frameworkId: fw.id })
    const bad = new NextRequest(`http://localhost/x`, { method: 'POST', body: '不是json' })
    expect((await PATCH(bad, ctx(t.id))).status).toBe(400)
  })
})

describe('可编辑窗口', () => {
  it('已发布 → 拒绝', async () => {
    const fw = await makeFramework()
    const t = await makeTask({ frameworkId: fw.id, published: true })
    expect((await PATCH(req(t.id, { audio: { bgmVolume: 0.4 } }), ctx(t.id))).status).toBe(400)
  })

  it('正在合成中 → 拒绝', async () => {
    const fw = await makeFramework()
    const t = await makeTask({ frameworkId: fw.id, renderStatus: 'RENDERING' })
    expect((await PATCH(req(t.id, { audio: { bgmVolume: 0.4 } }), ctx(t.id))).status).toBe(400)
  })

  it('素材就绪（还没合成过）→ 允许', async () => {
    const fw = await makeFramework()
    const t = await makeTask({ frameworkId: fw.id, status: 'ASSET_READY', renderStatus: null })
    const r = await PATCH(req(t.id, { audio: { bgmVolume: 0.4 } }), ctx(t.id))
    expect(r.status).toBe(200)
  })

  it('质检失败的成片 → 允许（正是要回头改的场景）', async () => {
    const fw = await makeFramework()
    const t = await makeTask({ frameworkId: fw.id, renderStatus: 'QC_FAILED' })
    expect((await PATCH(req(t.id, { audio: { bgmVolume: 0.4 } }), ctx(t.id))).status).toBe(200)
  })

  it('非运营 → 403（requireRole 把关）', async () => {
    const { HttpError } = await import('@/lib/auth')
    requireRoleMock.mockRejectedValue(new HttpError(403, '无权限'))
    const fw = await makeFramework()
    const t = await makeTask({ frameworkId: fw.id })
    expect((await PATCH(req(t.id, { audio: { bgmVolume: 0.4 } }), ctx(t.id))).status).toBe(403)
  })
})

describe('DELETE /api/generate/[id]/params', () => {
  it('清除覆盖，其它 variables 保留', async () => {
    const fw = await makeFramework()
    const t = await makeTask({ frameworkId: fw.id, variables: { __bgmId: 'b1', [TASK_PARAMS_KEY]: { audio: { bgmVolume: 0.1 } } } })
    await DELETE(req(t.id), ctx(t.id))
    const v = (await prisma.generationTask.findUniqueOrThrow({ where: { id: t.id } })).variables as Record<string, unknown>
    expect(v[TASK_PARAMS_KEY]).toBeUndefined()
    expect(v.__bgmId).toBe('b1')
  })
})

describe('POST /api/generate/[id]/params/promote', () => {
  it('合并进框架，并清掉任务上的覆盖', async () => {
    const fw = await makeFramework({ __style: 'warm', __templateParams: { mode: 'flash', audio: { bgmVolume: 0.69 } } })
    const t = await makeTask({ frameworkId: fw.id, variables: { [TASK_PARAMS_KEY]: { audio: { bgmVolume: 0.2 } } } })
    expect((await PROMOTE(req(t.id), ctx(t.id))).status).toBe(200)

    const fresh = await prisma.copyFramework.findUniqueOrThrow({ where: { id: fw.id } })
    const ot = fresh.overlayTemplate as Record<string, unknown>
    expect((ot.__templateParams as Record<string, unknown>).audio).toEqual({ bgmVolume: 0.2 })
    expect((ot.__templateParams as Record<string, unknown>).mode, '框架里没被覆盖的字段丢了').toBe('flash')
    expect(ot.__style, 'overlayTemplate 的其它键被踩掉了').toBe('warm')

    // ★ 必须清掉任务覆盖：同一份值存两处的话，之后改框架带不动这条任务，
    // 表现为"改了框架没生效"。
    expect(await readOverride(t.id)).toBeUndefined()
  })

  it('没有改过参数 → 400', async () => {
    const fw = await makeFramework()
    const t = await makeTask({ frameworkId: fw.id })
    expect((await PROMOTE(req(t.id), ctx(t.id))).status).toBe(400)
  })
})
