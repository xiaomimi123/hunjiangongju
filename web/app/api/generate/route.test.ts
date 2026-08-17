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

const { POST } = await import('./route')

const frameworkIds: string[] = []
const taskIds: string[] = []

afterAll(async () => {
  await prisma.generationTask.deleteMany({ where: { id: { in: taskIds } } })
  await prisma.copyFramework.deleteMany({ where: { id: { in: frameworkIds } } })
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
