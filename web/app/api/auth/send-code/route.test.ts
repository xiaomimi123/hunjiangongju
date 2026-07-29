import { describe, it, expect, vi, afterAll } from 'vitest'
import { NextRequest } from 'next/server'
import { prisma } from '@mixcut/db'

const registrationOpenMock = vi.fn()
vi.mock('@/lib/registration', () => ({ registrationOpen: () => registrationOpenMock() }))

const { POST } = await import('./route')

function req(body: unknown) {
  return new NextRequest('http://localhost/api/auth/send-code', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  })
}

describe('POST /api/auth/send-code 注册开关门控', () => {
  it('registrationOpen()=false → 403 注册未开放（不发码）', async () => {
    registrationOpenMock.mockResolvedValue(false)
    const res = await POST(req({ email: 'send-code-closed@example.com' }), { params: {} })
    expect(res.status).toBe(403)
    const json = await res.json()
    expect(json.error).toBe('注册未开放')
  })

  it('registrationOpen()=true → 放行进入后续校验（未开邮件服务时给 400，而非 403）', async () => {
    registrationOpenMock.mockResolvedValue(true)
    const res = await POST(req({ email: 'send-code-open@example.com' }), { params: {} })
    // 测试库默认未开启 SMTP，走到 emailEnabled() 校验即止——证明 403 门控已放行
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toBe('未开启邮件服务')
  })
})

afterAll(async () => {
  await prisma.$disconnect()
})
