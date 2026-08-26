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

async function makeStudent(credits?: number) {
  const u = await prisma.user.create({
    data: {
      email: `1${String(Date.now()).slice(-7)}${String(userIds.length).padStart(3, '0')}`,
      passwordHash: 'x', role: 'student', ...(credits === undefined ? {} : { credits }),
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

describe('学员生成积分（1 条视频 = 1 积分）', () => {
  it('新账号默认 30 积分', async () => {
    const u = await makeStudent()
    expect(u.credits).toBe(30)
  })

  it('积分充足 → 生成成功且扣 1 分', async () => {
    const u = await makeStudent(2)
    const fw = await makeFramework()
    requireRoleMock.mockResolvedValue({ userId: u.id, role: 'student' })
    const res = await POST(req({ frameworkId: fw.id, subject: '正常生成' }), { params: {} })
    expect(res.status).toBe(200)
    taskIds.push((await res.json()).id)
    expect((await prisma.user.findUniqueOrThrow({ where: { id: u.id } })).credits).toBe(1)
  })

  it('积分为 0 → 403 + NO_CREDITS 错误码，不建任务、不扣分', async () => {
    const u = await makeStudent(0)
    const fw = await makeFramework()
    requireRoleMock.mockResolvedValue({ userId: u.id, role: 'student' })
    const res = await POST(req({ frameworkId: fw.id, subject: '没分了' }), { params: {} })
    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.code, '前端靠这个码识别「该弹充值二维码」').toBe('NO_CREDITS')
    expect(body.error).toContain('积分')
    expect(await prisma.generationTask.count({ where: { createdBy: u.id } })).toBe(0)
    expect((await prisma.user.findUniqueOrThrow({ where: { id: u.id } })).credits).toBe(0)
  })

  // ★ 并发抢最后 1 分：updateMany 带 credits >= 1 条件是乐观闸，只放行一个
  it('并发抢最后 1 积分 → 恰好放行一个，余额归 0 不为负', async () => {
    const u = await makeStudent(1)
    const fw = await makeFramework()
    requireRoleMock.mockResolvedValue({ userId: u.id, role: 'student' })
    const results = await Promise.all([
      POST(req({ frameworkId: fw.id, subject: '并发甲' }), { params: {} }),
      POST(req({ frameworkId: fw.id, subject: '并发乙' }), { params: {} }),
    ])
    const codes = results.map((r) => r.status).sort()
    expect(codes).toEqual([200, 403])
    for (const r of results) if (r.status === 200) taskIds.push((await r.json()).id)
    expect((await prisma.user.findUniqueOrThrow({ where: { id: u.id } })).credits).toBe(0)
  })

  it('运营不受积分限制、不扣分', async () => {
    const fw = await makeFramework()
    requireRoleMock.mockResolvedValue({ userId: 'op-credits-x', role: 'operator' })
    const res = await POST(req({ frameworkId: fw.id, subject: '运营生成' }), { params: {} })
    expect(res.status).toBe(200)
    taskIds.push((await res.json()).id)
  })
})
