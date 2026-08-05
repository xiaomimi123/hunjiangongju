import { describe, it, expect, vi, beforeAll, afterEach, afterAll } from 'vitest'
import { NextRequest } from 'next/server'
import { prisma } from '@mixcut/db'
import { HttpError } from '@/lib/auth'

const requireRoleMock = vi.fn()
vi.mock('@/lib/auth', async () => {
  const actual = await vi.importActual<typeof import('@/lib/auth')>('@/lib/auth')
  return { ...actual, requireRole: (...args: unknown[]) => requireRoleMock(...args) }
})

const { GET } = await import('./route')

// 与其它 route.test.ts 并发跑在同一张共享测试库表上：绝不能用 deleteMany({}) 整表清空，只精确追踪本文件自己创建的行 id。
const createdFw: string[] = []

function req() {
  return new NextRequest('http://localhost/api/frameworks', { method: 'GET' })
}

beforeAll(() => {
  requireRoleMock.mockResolvedValue({ userId: 'op1', role: 'operator' })
})

afterEach(async () => {
  if (createdFw.length) {
    await prisma.copyFramework.deleteMany({ where: { id: { in: createdFw.splice(0) } } })
  }
})

afterAll(async () => {
  await prisma.$disconnect()
})

describe('GET /api/frameworks', () => {
  it('非 operator → 401/403', async () => {
    requireRoleMock.mockRejectedValueOnce(new HttpError(403, '无权限'))
    const res = await GET(req(), { params: {} })
    expect([401, 403]).toContain(res.status)
  })

  it('带 __defaultAssetFolder 的框架 → 响应含 defaultAssetFolder', async () => {
    const fw = await prisma.copyFramework.create({
      data: { name: '预填测试', frameworkText: 'x', overlayTemplate: { __defaultAssetFolder: '工程甲' } },
    })
    createdFw.push(fw.id)
    const res = await GET(req(), { params: {} })
    const rows = await res.json()
    const row = rows.find((r: { id: string }) => r.id === fw.id)
    expect(row.defaultAssetFolder).toBe('工程甲')
  })

  it('无 overlayTemplate 的框架 → defaultAssetFolder 为 null', async () => {
    const fw = await prisma.copyFramework.create({
      data: { name: '无预填测试', frameworkText: 'x' },
    })
    createdFw.push(fw.id)
    const res = await GET(req(), { params: {} })
    const rows = await res.json()
    const row = rows.find((r: { id: string }) => r.id === fw.id)
    expect(row.defaultAssetFolder).toBeNull()
  })
})
