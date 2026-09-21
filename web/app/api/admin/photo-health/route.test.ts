// 生图健康探针：最新 run 是 402 类失败 → 告警（含余额与失败计数）；最新是成功 → 无告警。
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import { NextRequest } from 'next/server'
import { prisma } from '@mixcut/db'

const requireRoleMock = vi.fn()
vi.mock('@/lib/auth', async () => {
  const actual = await vi.importActual<typeof import('@/lib/auth')>('@/lib/auth')
  return { ...actual, requireRole: (...args: unknown[]) => requireRoleMock(...args) }
})

let GET: typeof import('./route').GET
const userIds: string[] = []
const runIds: string[] = []

beforeAll(async () => {
  ;({ GET } = await import('./route'))
  requireRoleMock.mockResolvedValue({ userId: 'op1', role: 'operator' })
})
afterAll(async () => {
  await prisma.photoGenRun.deleteMany({ where: { id: { in: runIds } } })
  await prisma.user.deleteMany({ where: { id: { in: userIds } } })
  await prisma.$disconnect()
})

async function makeRun(status: string, errorMsg: string | null, at: Date) {
  if (userIds.length === 0) {
    const u = await prisma.user.create({
      data: { email: `ph-${process.pid}@test.local`, passwordHash: 'x', role: 'student' },
    })
    userIds.push(u.id)
  }
  const r = await prisma.photoGenRun.create({
    data: {
      userId: userIds[0], mode: 'cover', count: 1, status, errorMsg,
      inputImage: 'photo-uploads/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.jpg',
      createdAt: at,
    },
  })
  runIds.push(r.id)
  return r
}

const req = () => new NextRequest('http://localhost/api/admin/photo-health')

describe('photo-health', () => {
  it('最新 run 是余额不足失败 → 告警带余额与计数', async () => {
    await makeRun('FAILED', '生成失败：生图提交失败 402: {"error":{"message":"insufficient balance (current: 0.044492 USD, required: 0.06)"}}', new Date())
    const j = await (await GET(req(), { params: {} })).json()
    expect(j.alert).toBeTruthy()
    expect(j.alert.balance).toBe('0.044492')
    expect(j.alert.failedCount).toBeGreaterThanOrEqual(1)
  })

  it('之后出现成功 run → 告警消失', async () => {
    await makeRun('SUCCEEDED', null, new Date(Date.now() + 1000))
    const j = await (await GET(req(), { params: {} })).json()
    expect(j.alert).toBeNull()
  })

  it('最新是普通失败（非余额类）→ 不告警', async () => {
    await makeRun('FAILED', '生成失败：fetch failed', new Date(Date.now() + 2000))
    const j = await (await GET(req(), { params: {} })).json()
    expect(j.alert).toBeNull()
  })
})
