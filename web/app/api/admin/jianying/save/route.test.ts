import { describe, it, expect, vi, afterAll } from 'vitest'
import { NextRequest } from 'next/server'
import { prisma } from '@mixcut/db'
import { HttpError } from '@/lib/auth'

const requireRoleMock = vi.fn()
vi.mock('@/lib/auth', async () => {
  const actual = await vi.importActual<typeof import('@/lib/auth')>('@/lib/auth')
  return { ...actual, requireRole: (...args: unknown[]) => requireRoleMock(...args) }
})

const { POST } = await import('./route')

// 与其它 route.test.ts 并发跑在同一张共享测试库表上：只精确追踪本文件自己创建的行 id，不整表清空。
const createdFw: string[] = []

function req(body: unknown) {
  return new NextRequest('http://localhost/api/admin/jianying/save', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  })
}

const VALID_REPORT = {
  parsedAt: '2026-08-19T00:00:00.000Z',
  summary: { extracted: 2, defaulted: 1, unsupported: 0 },
  entries: [
    { path: 'canvas', status: 'extracted' },
    { path: 'durationMs', status: 'extracted' },
    { path: 'transition.durationMs', status: 'defaulted', detail: '未找到转场素材，回退默认转场时长' },
  ],
}

describe('POST /api/admin/jianying/save', () => {
  it('非 operator → 401/403', async () => {
    requireRoleMock.mockRejectedValueOnce(new HttpError(403, '无权限'))
    const res = await POST(req({ name: 'x', templateParams: { mode: 'flash' } }), { params: {} })
    expect([401, 403]).toContain(res.status)
  })

  it('name 为空 → 400', async () => {
    requireRoleMock.mockResolvedValueOnce({ userId: 'op1', role: 'operator' })
    const res = await POST(req({ name: ' ', templateParams: { mode: 'flash' } }), { params: {} })
    expect(res.status).toBe(400)
  })

  it('带合法 fidelityReport → 原样落库到 draftFidelityReport', async () => {
    requireRoleMock.mockResolvedValueOnce({ userId: 'op1', role: 'operator' })
    const res = await POST(req({ name: '保存测试-带报告', templateParams: { mode: 'flash' }, fidelityReport: VALID_REPORT }), { params: {} })
    expect(res.status).toBe(200)
    const j = await res.json()
    createdFw.push(j.id)
    const fw = await prisma.copyFramework.findUniqueOrThrow({ where: { id: j.id } })
    expect(fw.draftFidelityReport).toEqual(VALID_REPORT)
  })

  it('不带 fidelityReport → draftFidelityReport 为 null（与现状一致）', async () => {
    requireRoleMock.mockResolvedValueOnce({ userId: 'op1', role: 'operator' })
    const res = await POST(req({ name: '保存测试-无报告', templateParams: { mode: 'flash' } }), { params: {} })
    expect(res.status).toBe(200)
    const j = await res.json()
    createdFw.push(j.id)
    const fw = await prisma.copyFramework.findUniqueOrThrow({ where: { id: j.id } })
    expect(fw.draftFidelityReport).toBeNull()
  })

  it('fidelityReport 形状不合法（客户端可篡改的字段）→ 静默丢弃,不硬失败,照常建框架', async () => {
    requireRoleMock.mockResolvedValueOnce({ userId: 'op1', role: 'operator' })
    const res = await POST(
      req({ name: '保存测试-非法报告', templateParams: { mode: 'flash' }, fidelityReport: { hacked: true } }),
      { params: {} },
    )
    expect(res.status).toBe(200)
    const j = await res.json()
    createdFw.push(j.id)
    const fw = await prisma.copyFramework.findUniqueOrThrow({ where: { id: j.id } })
    expect(fw.draftFidelityReport).toBeNull()
  })
})

afterAll(async () => {
  if (createdFw.length) {
    await prisma.copyFramework.deleteMany({ where: { id: { in: createdFw } } })
  }
  await prisma.$disconnect()
})
