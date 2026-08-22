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
  // ★ 注册已改为手机号 + 密码：这个端点显式关闭（留着 = 邮箱建号旁路）
  it('端点已关闭 → 恒 410，与注册开关无关', async () => {
    registrationOpenMock.mockResolvedValue(false)
    const res = await POST(req({ email: 'send-code-closed@example.com' }), { params: {} })
    expect(res.status).toBe(410)
  })

  it('注册开关打开也一样 410（不发任何邮件）', async () => {
    registrationOpenMock.mockResolvedValue(true)
    const res = await POST(req({ email: 'send-code-open@example.com' }), { params: {} })
    expect(res.status).toBe(410)
  })
})

afterAll(async () => {
  await prisma.$disconnect()
})
