import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest'
import { NextRequest } from 'next/server'
import { prisma } from '@mixcut/db'

const requireRoleMock = vi.fn()
vi.mock('@/lib/auth', async () => {
  const actual = await vi.importActual<typeof import('@/lib/auth')>('@/lib/auth')
  return { ...actual, requireRole: (...args: unknown[]) => requireRoleMock(...args) }
})
vi.mock('@mixcut/db', async () => {
  const actual = await vi.importActual<typeof import('@mixcut/db')>('@mixcut/db')
  return { ...actual, enqueueGen: vi.fn() }
})

const { POST } = await import('./route')

const userIds: string[] = []
const fwIds: string[] = []
const taskIds: string[] = []

afterAll(async () => {
  await prisma.generationTask.deleteMany({ where: { id: { in: taskIds } } })
  await prisma.generationTask.deleteMany({ where: { createdBy: { in: userIds } } })
  await prisma.copyFramework.deleteMany({ where: { id: { in: fwIds } } })
  await prisma.user.deleteMany({ where: { id: { in: userIds } } })
  await prisma.$disconnect()
})

const bjToday = () => new Date(new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10))
const yesterday = () => new Date(bjToday().getTime() - 24 * 3600_000)

async function makeStudent(genLimit: number | null, genUsed = 0, genUsedDate: Date | null = bjToday()) {
  const u = await prisma.user.create({
    data: {
      email: `1${String(Date.now()).slice(-7)}${String(userIds.length).padStart(3, '0')}`,
      passwordHash: 'x', role: 'student', genLimit, genUsed, genUsedDate,
    },
  })
  userIds.push(u.id)
  return u
}
async function makeFramework() {
  const fw = await prisma.copyFramework.create({ data: { frameworkText: 'T', published: true } })
  fwIds.push(fw.id)
  return fw
}

const req = (body: unknown) =>
  new NextRequest('http://localhost/api/generate', { method: 'POST', body: JSON.stringify(body) })

beforeEach(() => { requireRoleMock.mockReset() })

describe('学员生成配额（按日，0 点北京时间重置）', () => {
  // ★ 核心语义：昨天用满，今天第一次生成自动归零重记——不需要任何定时任务
  it('昨天用满 → 今天自动重置放行，今日计数从 1 重记', async () => {
    const u = await makeStudent(2, 2, yesterday())
    const fw = await makeFramework()
    requireRoleMock.mockResolvedValue({ userId: u.id, role: 'student' })
    const res = await POST(req({ frameworkId: fw.id, subject: '跨天重置' }), { params: {} })
    expect(res.status).toBe(200)
    taskIds.push((await res.json()).id)
    const fresh = await prisma.user.findUniqueOrThrow({ where: { id: u.id } })
    expect(fresh.genUsed, '今日计数应从 1 重记，而不是接着昨天的 2').toBe(1)
    expect(fresh.genUsedDate?.getTime()).toBe(bjToday().getTime())
  })

  it('额度不累计：昨天一条没用，今天额度仍是 limit 本身', async () => {
    const u = await makeStudent(1, 0, yesterday())
    const fw = await makeFramework()
    requireRoleMock.mockResolvedValue({ userId: u.id, role: 'student' })
    expect((await POST(req({ frameworkId: fw.id, subject: '第一条' }), { params: {} })).status).toBe(200)
    const r2 = await POST(req({ frameworkId: fw.id, subject: '第二条' }), { params: {} })
    expect(r2.status, '昨天剩的额度不能滚存到今天').toBe(403)
  })

  it('今日额度用满 → 403，且不建任务、不再扣次数', async () => {
    const u = await makeStudent(2, 2)
    const fw = await makeFramework()
    requireRoleMock.mockResolvedValue({ userId: u.id, role: 'student' })
    const res = await POST(req({ frameworkId: fw.id, subject: '超限测试' }), { params: {} })
    expect(res.status).toBe(403)
    expect((await res.json()).error).toContain('今日生成次数已用完')
    expect(await prisma.generationTask.count({ where: { createdBy: u.id } })).toBe(0)
    const fresh = await prisma.user.findUniqueOrThrow({ where: { id: u.id } })
    expect(fresh.genUsed, '拒绝时不能扣次数').toBe(2)
  })

  it('额度未满 → 建号成功且已用 +1', async () => {
    const u = await makeStudent(2, 1)
    const fw = await makeFramework()
    requireRoleMock.mockResolvedValue({ userId: u.id, role: 'student' })
    const res = await POST(req({ frameworkId: fw.id, subject: '正常生成' }), { params: {} })
    expect(res.status).toBe(200)
    taskIds.push((await res.json()).id)
    const fresh = await prisma.user.findUniqueOrThrow({ where: { id: u.id } })
    expect(fresh.genUsed).toBe(2)
  })

  it('不限额（genLimit=null）→ 放行，但已用照常记账（以后设上限时知道用了多少）', async () => {
    const u = await makeStudent(null, 5)
    const fw = await makeFramework()
    requireRoleMock.mockResolvedValue({ userId: u.id, role: 'student' })
    const res = await POST(req({ frameworkId: fw.id, subject: '不限额' }), { params: {} })
    expect(res.status).toBe(200)
    taskIds.push((await res.json()).id)
    expect((await prisma.user.findUniqueOrThrow({ where: { id: u.id } })).genUsed).toBe(6)
  })

  it('额度为 0 → 一条都不许生成', async () => {
    const u = await makeStudent(0, 0)
    const fw = await makeFramework()
    requireRoleMock.mockResolvedValue({ userId: u.id, role: 'student' })
    expect((await POST(req({ frameworkId: fw.id, subject: 'x' }), { params: {} })).status).toBe(403)
  })

  it('额度为 0 且日期已过期 → 跨天重置也不放行，且计数回滚', async () => {
    const u = await makeStudent(0, 0, yesterday())
    const fw = await makeFramework()
    requireRoleMock.mockResolvedValue({ userId: u.id, role: 'student' })
    expect((await POST(req({ frameworkId: fw.id, subject: 'x' }), { params: {} })).status).toBe(403)
    const fresh = await prisma.user.findUniqueOrThrow({ where: { id: u.id } })
    expect(fresh.genUsed, '事务应回滚，重置分支写入的 1 不能留下').toBe(0)
    expect(await prisma.generationTask.count({ where: { createdBy: u.id } })).toBe(0)
  })

  // ★ 并发抢最后一个名额：updateMany 的 genUsed 条件是乐观闸，只有一个能占到坑
  it('并发挤最后一个名额 → 恰好放行一个', async () => {
    const u = await makeStudent(1, 0)
    const fw = await makeFramework()
    requireRoleMock.mockResolvedValue({ userId: u.id, role: 'student' })
    const results = await Promise.all([
      POST(req({ frameworkId: fw.id, subject: '并发甲' }), { params: {} }),
      POST(req({ frameworkId: fw.id, subject: '并发乙' }), { params: {} }),
    ])
    const codes = results.map((r) => r.status).sort()
    expect(codes).toEqual([200, 403])
    for (const r of results) if (r.status === 200) taskIds.push((await r.json()).id)
    expect((await prisma.user.findUniqueOrThrow({ where: { id: u.id } })).genUsed).toBe(1)
  })

  it('运营不受配额限制、不记账', async () => {
    const fw = await makeFramework()
    requireRoleMock.mockResolvedValue({ userId: 'op-quota-x', role: 'operator' })
    const res = await POST(req({ frameworkId: fw.id, subject: '运营生成' }), { params: {} })
    expect(res.status).toBe(200)
    taskIds.push((await res.json()).id)
  })
})
