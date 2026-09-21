// 积分流水统计与全站流水接口测试：分类聚合、大户排行、沉睡判定（按业务活动而非流水）、
// 流水的类型筛选与分页。
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import { NextRequest } from 'next/server'
import { prisma } from '@mixcut/db'

const requireRoleMock = vi.fn()
vi.mock('@/lib/auth', async () => {
  const actual = await vi.importActual<typeof import('@/lib/auth')>('@/lib/auth')
  return { ...actual, requireRole: (...args: unknown[]) => requireRoleMock(...args) }
})

let statsGET: typeof import('./route').GET
let logsGET: typeof import('../credit-logs/route').GET

const userIds: string[] = []
const fwIds: string[] = []

beforeAll(async () => {
  ;({ GET: statsGET } = await import('./route'))
  ;({ GET: logsGET } = await import('../credit-logs/route'))
  requireRoleMock.mockResolvedValue({ userId: 'op1', role: 'operator' })
})

afterAll(async () => {
  await prisma.creditLog.deleteMany({ where: { userId: { in: userIds } } })
  await prisma.generationTask.deleteMany({ where: { createdBy: { in: userIds } } })
  await prisma.copyFramework.deleteMany({ where: { id: { in: fwIds } } })
  await prisma.user.deleteMany({ where: { id: { in: userIds } } })
  await prisma.$disconnect()
})

let seq = 0
async function makeStudent(credits: number, nickname?: string) {
  seq += 1
  const u = await prisma.user.create({
    data: { email: `cs-${process.pid}-${seq}@test.local`, passwordHash: 'x', role: 'student', credits, nickname },
  })
  userIds.push(u.id)
  return u
}
async function log(userId: string, delta: number, reason: string) {
  await prisma.creditLog.create({ data: { userId, delta, reason } })
}

describe('credit-stats', () => {
  it('分类聚合 + 大户排行 + 沉睡判定', async () => {
    const big = await makeStudent(500, '大户')
    const dormant = await makeStudent(800, '沉睡')
    const active = await makeStudent(300, '活跃但没消费流水')
    // 大户:视频 300 + 生图 8 + 工具 50;还有一笔充值与退回
    await log(big.id, -300, '生成视频')
    await log(big.id, -8, '实拍生图（1 张）')
    await log(big.id, -50, '工具·书单')
    await log(big.id, 47000, 'recharge')
    await log(big.id, 8, '实拍生图退回（生成失败）')
    // 活跃户:近 30 天有生成任务(业务活动)但无消费流水——不能进沉睡榜
    const fw = await prisma.copyFramework.create({ data: { frameworkText: 'T', published: true } })
    fwIds.push(fw.id)
    await prisma.generationTask.create({ data: { frameworkId: fw.id, subject: 's', createdBy: active.id } })

    const res = await statsGET(new NextRequest('http://localhost/api/admin/credit-stats'), { params: {} })
    expect(res.status).toBe(200)
    const j = await res.json()

    expect(j.summary.recharge).toBeGreaterThanOrEqual(47000)
    expect(j.summary.consumed).toBeGreaterThanOrEqual(358)
    expect(j.summary.refunded).toBeGreaterThanOrEqual(8)
    expect(j.byProduct.video).toBeGreaterThanOrEqual(300)
    expect(j.byProduct.photo).toBeGreaterThanOrEqual(8)
    expect(j.byProduct.tool).toBeGreaterThanOrEqual(50)

    const top = j.topConsumers.find((u: { email: string }) => u.email === big.email)
    expect(top).toBeTruthy()
    expect(top.consumed).toBe(358)

    const dormantEmails = j.dormant.map((u: { email: string }) => u.email)
    expect(dormantEmails).toContain(dormant.email)
    expect(dormantEmails).not.toContain(active.email) // 有业务活动不算沉睡
    expect(dormantEmails).not.toContain(big.email)
  })
})

describe('credit-logs', () => {
  it('类型筛选：consume 只出负数,refund 不含充值', async () => {
    const u = await makeStudent(100, '筛选')
    await log(u.id, -20, '生成视频')
    await log(u.id, 20, '实拍生图退回（生成失败）')
    await log(u.id, 5000, 'recharge')

    const consume = await (await logsGET(new NextRequest(`http://localhost/x?type=consume&q=${u.email}`), { params: {} })).json()
    expect(consume.logs).toHaveLength(1)
    expect(consume.logs[0].delta).toBe(-20)

    const refund = await (await logsGET(new NextRequest(`http://localhost/x?type=refund&q=${u.email}`), { params: {} })).json()
    expect(refund.logs).toHaveLength(1)
    expect(refund.logs[0].reason).toContain('退回')

    const all = await (await logsGET(new NextRequest(`http://localhost/x?q=${u.email}`), { params: {} })).json()
    expect(all.logs).toHaveLength(3)
    expect(all.logs[0].email).toBe(u.email)
  })
})
