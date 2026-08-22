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

async function makeStudent(genLimit: number | null, genUsed = 0) {
  const u = await prisma.user.create({
    data: {
      email: `1${String(Date.now()).slice(-7)}${String(userIds.length).padStart(3, '0')}`,
      passwordHash: 'x', role: 'student', genLimit, genUsed,
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

describe('学员生成配额', () => {
  it('额度用满 → 403，且不建任务、不再扣次数', async () => {
    const u = await makeStudent(2, 2)
    const fw = await makeFramework()
    requireRoleMock.mockResolvedValue({ userId: u.id, role: 'student' })
    const res = await POST(req({ frameworkId: fw.id, subject: '超限测试' }), { params: {} })
    expect(res.status).toBe(403)
    expect((await res.json()).error).toContain('生成次数已用完')
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
