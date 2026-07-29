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

  it('registrationOpen()=true → 放行，正常校验/创建流程生效', async () => {
    registrationOpenMock.mockResolvedValue(true)
    const email = `gate-open-${Date.now()}@example.com`
    cleanupEmails.push(email)
    const res = await POST(req({ email, password: 'password123' }), { params: {} })
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.needsVerification).toBe(false)
    expect(await prisma.user.findUnique({ where: { email } })).not.toBeNull()
  })
})

afterAll(async () => {
  for (const email of cleanupEmails) await prisma.user.deleteMany({ where: { email } })
  await prisma.$disconnect()
})
