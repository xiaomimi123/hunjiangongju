import { describe, it, expect, vi, afterAll } from 'vitest'
import { NextRequest } from 'next/server'
import { prisma } from '@mixcut/db'

const registrationOpenMock = vi.fn()
vi.mock('@/lib/registration', () => ({ registrationOpen: () => registrationOpenMock() }))

const { POST } = await import('./route')

function req(body: unknown) {
  return new NextRequest('http://localhost/api/auth/register', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  })
}

const cleanupEmails: string[] = []

describe('POST /api/auth/register 注册开关门控', () => {
  it('registrationOpen()=false → 403 注册未开放', async () => {
    registrationOpenMock.mockResolvedValue(false)
    const res = await POST(req({ email: 'gate-closed@example.com', password: 'password123' }), { params: {} })
    expect(res.status).toBe(403)
    const json = await res.json()
    expect(json.error).toBe('注册未开放')
  })

  it('registrationOpen()=true → 11 位手机号 + 密码直接注册（无验证码环节）', async () => {
    registrationOpenMock.mockResolvedValue(true)
    const phone = `137${String(Date.now()).slice(-8)}`
    cleanupEmails.push(phone)
    const res = await POST(req({ email: phone, password: 'password123' }), { params: {} })
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.needsVerification).toBe(false)
    const u = await prisma.user.findUnique({ where: { email: phone } })
    expect(u).not.toBeNull()
    expect(u?.role).toBe('student')
  })

  // ★ 账号体系（用户拍板）：注册一律 11 位手机号，邮箱注册不再放行
  it('邮箱格式 → 400（注册已改手机号）', async () => {
    registrationOpenMock.mockResolvedValue(true)
    const res = await POST(req({ email: `old-${Date.now()}@example.com`, password: 'password123' }), { params: {} })
    expect(res.status).toBe(400)
  })
})

afterAll(async () => {
  for (const email of cleanupEmails) await prisma.user.deleteMany({ where: { email } })
  await prisma.$disconnect()
})
