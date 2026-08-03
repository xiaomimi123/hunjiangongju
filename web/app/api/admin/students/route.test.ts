import { describe, it, expect, vi, afterAll } from 'vitest'
import { NextRequest } from 'next/server'
import { prisma } from '@mixcut/db'
import { HttpError } from '@/lib/auth'

const requireRoleMock = vi.fn()
vi.mock('@/lib/auth', async () => {
  const actual = await vi.importActual<typeof import('@/lib/auth')>('@/lib/auth')
  return { ...actual, requireRole: (...args: unknown[]) => requireRoleMock(...args) }
})

const { GET, POST } = await import('./route')

function postReq(body: unknown) {
  return new NextRequest('http://localhost/api/admin/students', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  })
}
function getReq(qs: string) {
  return new NextRequest(`http://localhost/api/admin/students${qs}`)
}

const cleanupEmails: string[] = []
function track(email: string) { cleanupEmails.push(email); return email }

describe('POST /api/admin/students', () => {
  it('创建学员', async () => {
    requireRoleMock.mockResolvedValueOnce({ userId: 'op1', role: 'operator' })
    const email = track(`new-student-${Date.now()}@example.com`)
    const res = await POST(postReq({ email, nickname: '小明', password: 'password123', role: 'student' }), { params: {} })
    expect(res.status).toBe(201)
    const json = await res.json()
    expect(json.role).toBe('student')
    expect(json.email).toBe(email)
    const u = await prisma.user.findUnique({ where: { email } })
    expect(u).not.toBeNull()
    expect(u?.role).toBe('student')
    expect(u?.passwordHash).not.toBe('password123')
  })

  it('创建运营', async () => {
    requireRoleMock.mockResolvedValueOnce({ userId: 'op1', role: 'operator' })
    const email = track(`new-operator-${Date.now()}@example.com`)
    const res = await POST(postReq({ email, nickname: '运营甲', password: 'password123', role: 'operator' }), { params: {} })
    expect(res.status).toBe(201)
    const json = await res.json()
    expect(json.role).toBe('operator')
    const u = await prisma.user.findUnique({ where: { email } })
    expect(u?.role).toBe('operator')
  })

  it('重复 email → 409', async () => {
    requireRoleMock.mockResolvedValueOnce({ userId: 'op1', role: 'operator' })
    const email = track(`dup-${Date.now()}@example.com`)
    await POST(postReq({ email, password: 'password123', role: 'student' }), { params: {} })
    requireRoleMock.mockResolvedValueOnce({ userId: 'op1', role: 'operator' })
    const res = await POST(postReq({ email, password: 'password123', role: 'student' }), { params: {} })
    expect(res.status).toBe(409)
  })

  it('非法 role → 400', async () => {
    requireRoleMock.mockResolvedValueOnce({ userId: 'op1', role: 'operator' })
    const email = track(`bad-role-${Date.now()}@example.com`)
    const res = await POST(postReq({ email, password: 'password123', role: 'admin' }), { params: {} })
    expect(res.status).toBe(400)
  })

  it('弱密码 → 400', async () => {
    requireRoleMock.mockResolvedValueOnce({ userId: 'op1', role: 'operator' })
    const email = track(`weak-pw-${Date.now()}@example.com`)
    const res = await POST(postReq({ email, password: '123', role: 'student' }), { params: {} })
    expect(res.status).toBe(400)
  })

  it('非法邮箱 → 400', async () => {
    requireRoleMock.mockResolvedValueOnce({ userId: 'op1', role: 'operator' })
    const res = await POST(postReq({ email: 'not-an-email', password: 'password123', role: 'student' }), { params: {} })
    expect(res.status).toBe(400)
  })

  it('非 operator → 401/403', async () => {
    requireRoleMock.mockRejectedValueOnce(new HttpError(403, '无权限'))
    const res = await POST(postReq({ email: 'x@example.com', password: 'password123', role: 'student' }), { params: {} })
    expect([401, 403]).toContain(res.status)
  })
})

describe('GET /api/admin/students', () => {
  it('role=operator 只返回运营', async () => {
    requireRoleMock.mockResolvedValueOnce({ userId: 'op1', role: 'operator' })
    const email = track(`op-list-${Date.now()}@example.com`)
    await prisma.user.create({ data: { email, passwordHash: 'x', role: 'operator' } })

    requireRoleMock.mockResolvedValueOnce({ userId: 'op1', role: 'operator' })
    const res = await GET(getReq('?role=operator'), { params: {} })
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.students.every((s: { id: string }) => true)).toBe(true)
    const found = json.students.find((s: { email: string }) => s.email === email)
    expect(found).toBeTruthy()
  })

  it('缺省 role → 现有学员逻辑不受影响', async () => {
    requireRoleMock.mockResolvedValueOnce({ userId: 'op1', role: 'operator' })
    const res = await GET(getReq(''), { params: {} })
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.stats).toBeDefined()
    expect(Array.isArray(json.students)).toBe(true)
  })
})

afterAll(async () => {
  for (const email of cleanupEmails) await prisma.user.deleteMany({ where: { email } })
  await prisma.$disconnect()
})
