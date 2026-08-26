import { describe, it, expect, vi, afterAll } from 'vitest'
import { NextRequest } from 'next/server'
import { prisma } from '@mixcut/db'

const requireRoleMock = vi.fn()
vi.mock('@/lib/auth', async () => {
  const actual = await vi.importActual<typeof import('@/lib/auth')>('@/lib/auth')
  return { ...actual, requireRole: (...args: unknown[]) => requireRoleMock(...args) }
})

const { GET } = await import('./route')

const userIds: string[] = []
afterAll(async () => {
  await prisma.creditLog.deleteMany({ where: { userId: { in: userIds } } })
  await prisma.user.deleteMany({ where: { id: { in: userIds } } })
  await prisma.$disconnect()
})

describe('GET credit-logs — 学员充值流水（新到旧）', () => {
  it('返回该学员的流水，按时间倒序', async () => {
    const u = await prisma.user.create({
      data: { email: `1${String(Date.now()).slice(-7)}l01`, passwordHash: 'x', role: 'student' },
    })
    userIds.push(u.id)
    await prisma.creditLog.create({ data: { userId: u.id, delta: 10, reason: 'recharge', operatorId: 'op-1', createdAt: new Date('2026-08-01') } })
    await prisma.creditLog.create({ data: { userId: u.id, delta: 20, reason: 'recharge', operatorId: 'op-1', createdAt: new Date('2026-08-02') } })
    requireRoleMock.mockResolvedValue({ userId: 'op-1', role: 'operator' })
    const res = await GET(new NextRequest('http://localhost/x'), { params: { id: u.id } })
    expect(res.status).toBe(200)
    const { logs } = await res.json()
    expect(logs.map((l: { delta: number }) => l.delta)).toEqual([20, 10])
  })
})
