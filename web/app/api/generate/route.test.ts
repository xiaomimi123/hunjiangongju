import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import { NextRequest } from 'next/server'
import { prisma } from '@mixcut/db'

const requireRoleMock = vi.fn()
vi.mock('@/lib/auth', async () => {
  const actual = await vi.importActual<typeof import('@/lib/auth')>('@/lib/auth')
  return { ...actual, requireRole: (...args: unknown[]) => requireRoleMock(...args) }
})

// select-books 等下游 job 靠 BullMQ/Redis 真实入队，路由测试只关心 HTTP 层行为，
// 用 no-op 替身避免测试对 Redis 产生真实副作用/依赖。
const enqueueGenMock = vi.fn()
vi.mock('@mixcut/db', async () => {
  const actual = await vi.importActual<typeof import('@mixcut/db')>('@mixcut/db')
  return { ...actual, enqueueGen: (...args: unknown[]) => enqueueGenMock(...args) }
})

const { POST, GET } = await import('./route')

const frameworkIds: string[] = []
const taskIds: string[] = []
const userIds: string[] = []

afterAll(async () => {
  await prisma.generationTask.deleteMany({ where: { id: { in: taskIds } } })
  await prisma.copyFramework.deleteMany({ where: { id: { in: frameworkIds } } })
  await prisma.user.deleteMany({ where: { id: { in: userIds } } })
  await prisma.$disconnect()
})

async function makeFramework(published = true) {
  const fw = await prisma.copyFramework.create({
    data: { frameworkText: '测试框架文本', published },
  })
  frameworkIds.push(fw.id)
  return fw
}

function req(body: unknown) {
  return new NextRequest('http://localhost/api/generate', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  })
}

async function call(body: unknown) {
  const res = await POST(req(body), { params: {} })
  if (res.status === 200) {
    const j = await res.json()
    if (j?.id) taskIds.push(j.id)
    return { res, json: j }
  }
  return { res, json: await res.json().catch(() => ({})) }
}

describe('POST /api/generate 限流', () => {
  it('学员：超过每分钟限额 → 429（每次生成现会打出约 20 次联网检索 LLM 调用，防止连点刷成本）', async () => {
    const fw = await makeFramework()
    const userId = 'stu-ratelimit-1'
    requireRoleMock.mockResolvedValue({ userId, role: 'student' })
    let lastRes: Response | null = null
    // 限额本身在实现里定义；这里连续打到明显超限为止（留够冗余），断言最终被 429 挡住
    for (let i = 0; i < 12; i++) {
      const { res } = await call({ frameworkId: fw.id, subject: `选题${i}` })
      lastRes = res
      if (res.status === 429) break
    }
    expect(lastRes?.status).toBe(429)
  })

  it('运营：不受限流影响（studio 工作流不应被学员端限额卡住）', async () => {
    const fw = await makeFramework()
    const userId = 'op-ratelimit-1'
    requireRoleMock.mockResolvedValue({ userId, role: 'operator' })
    for (let i = 0; i < 12; i++) {
      const { res } = await call({ frameworkId: fw.id, subject: `选题${i}` })
      expect(res.status).toBe(200)
    }
  })
})

// GET 列表的可见范围：学员只看自己的；运营要能看到全部（含学员生成的），
// 否则后台「生成栏」永远看不到学员的任务——任务在库里状态正常流转，后台却是空的。
describe('GET /api/generate —— 列表可见范围', () => {
  // ★ 游标分页：翻页不重不漏。原先运营列表 200 条硬上限，超出静默丢弃、翻不到旧任务，
  // 数据多了整页一次性渲染也卡。
  it('游标分页：两页拼起来不重不漏、按时间倒序', async () => {
    const fw = await makeFramework()
    const created: string[] = []
    for (let i = 0; i < 55; i++) {
      const t = await prisma.generationTask.create({
        data: { frameworkId: fw.id, subject: `分页任务${i}`, createdBy: 'page-stu' },
      })
      created.push(t.id)
      taskIds.push(t.id)
    }
    requireRoleMock.mockResolvedValue({ userId: 'page-stu', role: 'student' })
    const p1 = (await (await GET(new NextRequest('http://localhost/api/generate'), { params: {} })).json()) as
      { tasks: { id: string }[]; nextCursor?: string }
    expect(p1.tasks.length).toBe(50)
    expect(p1.nextCursor, '55 条应有下一页').toBeTruthy()
    const p2 = (await (await GET(new NextRequest(`http://localhost/api/generate?cursor=${p1.nextCursor}`), { params: {} })).json()) as
      { tasks: { id: string }[]; nextCursor?: string }
    const all = [...p1.tasks, ...p2.tasks].map((t) => t.id)
    expect(new Set(all).size, '两页之间有重复').toBe(all.length)
    for (const id of created) expect(all, '有任务被分页漏掉').toContain(id)
  })

  it('学员只看得到自己创建的任务', async () => {
    const fw = await makeFramework()
    const mine = await prisma.generationTask.create({ data: { frameworkId: fw.id, subject: '学员甲的选题', createdBy: 'stu-a' } })
    const others = await prisma.generationTask.create({ data: { frameworkId: fw.id, subject: '学员乙的选题', createdBy: 'stu-b' } })
    taskIds.push(mine.id, others.id)

    requireRoleMock.mockResolvedValueOnce({ userId: 'stu-a', role: 'student' })
    const res = await GET(new NextRequest('http://localhost/api/generate'), { params: {} })
    const list = ((await res.json()) as { tasks: { id: string }[] }).tasks
    const ids = list.map((t) => t.id)
    expect(ids).toContain(mine.id)
    expect(ids).not.toContain(others.id)
  })

  it('运营看得到学员创建的任务，并带上创建人昵称', async () => {
    const fw = await makeFramework()
    const stu = await prisma.user.create({
      data: { email: `gen-list-stu-${Date.now()}@example.com`, passwordHash: 'x', role: 'student', nickname: '学员小王' },
    })
    userIds.push(stu.id)
    const t = await prisma.generationTask.create({ data: { frameworkId: fw.id, subject: '学员生成的选题', createdBy: stu.id } })
    taskIds.push(t.id)

    requireRoleMock.mockResolvedValueOnce({ userId: 'op-1', role: 'operator' })
    const res = await GET(new NextRequest('http://localhost/api/generate'), { params: {} })
    const list = ((await res.json()) as { tasks: { id: string; creator?: { nickname: string | null } | null }[] }).tasks
    const found = list.find((x) => x.id === t.id)
    expect(found).toBeTruthy()
    expect(found?.creator?.nickname).toBe('学员小王')
  })
})
