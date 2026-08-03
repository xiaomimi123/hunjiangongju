import { describe, it, expect, vi, afterAll } from 'vitest'
import { NextRequest } from 'next/server'
import { prisma } from '@mixcut/db'
import bcrypt from 'bcryptjs'

const requireRoleMock = vi.fn()
vi.mock('@/lib/auth', async () => {
  const actual = await vi.importActual<typeof import('@/lib/auth')>('@/lib/auth')
  return { ...actual, requireRole: (...args: unknown[]) => requireRoleMock(...args) }
})

const { GET, PATCH, DELETE } = await import('./route')

function patchReq(body: unknown) {
  return new NextRequest('http://localhost/api/admin/students/x', {
    method: 'PATCH',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  })
}
function delReq() {
  return new NextRequest('http://localhost/api/admin/students/x', { method: 'DELETE' })
}
function getReq() {
  return new NextRequest('http://localhost/api/admin/students/x')
}

const cleanupEmails: string[] = []
async function makeUser(role: 'student' | 'operator', disabled = false) {
  const email = `id-route-${role}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`
  cleanupEmails.push(email)
  const u = await prisma.user.create({ data: { email, passwordHash: await bcrypt.hash('password123', 10), role, disabled } })
  return u
}

describe('[id] route — 学员（现有行为不受影响）', () => {
  it('GET 返回学员作品', async () => {
    const s = await makeUser('student')
    requireRoleMock.mockResolvedValueOnce({ userId: 'op-self', role: 'operator' })
    const res = await GET(getReq(), { params: { id: s.id } })
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(Array.isArray(json.tasks)).toBe(true)
  })

  it('PATCH 禁用学员', async () => {
    const s = await makeUser('student')
    requireRoleMock.mockResolvedValueOnce({ userId: 'op-self', role: 'operator' })
    const res = await PATCH(patchReq({ action: 'disable' }), { params: { id: s.id } })
    expect(res.status).toBe(200)
    expect((await prisma.user.findUnique({ where: { id: s.id } }))?.disabled).toBe(true)
  })

  it('DELETE 删除学员', async () => {
    const s = await makeUser('student')
    requireRoleMock.mockResolvedValueOnce({ userId: 'op-self', role: 'operator' })
    const res = await DELETE(delReq(), { params: { id: s.id } })
    expect(res.status).toBe(200)
    expect(await prisma.user.findUnique({ where: { id: s.id } })).toBeNull()
  })

  it('目标不存在 → 404', async () => {
    requireRoleMock.mockResolvedValueOnce({ userId: 'op-self', role: 'operator' })
    const res = await PATCH(patchReq({ action: 'disable' }), { params: { id: 'no-such-id' } })
    expect(res.status).toBe(404)
  })
})

describe('[id] route — 运营账号防锁死', () => {
  it('操作自己 → 400', async () => {
    const self = await makeUser('operator')
    requireRoleMock.mockResolvedValueOnce({ userId: self.id, role: 'operator' })
    const res = await PATCH(patchReq({ action: 'disable' }), { params: { id: self.id } })
    expect(res.status).toBe(400)
  })

  it('删除自己 → 400', async () => {
    const self = await makeUser('operator')
    requireRoleMock.mockResolvedValueOnce({ userId: self.id, role: 'operator' })
    const res = await DELETE(delReq(), { params: { id: self.id } })
    expect(res.status).toBe(400)
  })

  it('禁用最后一名可用运营 → 400', async () => {
    // 暂时禁用其余所有已启用运营，只留下目标本身；测试结束后还原，避免污染共享测试库
    const others = await prisma.user.findMany({ where: { role: 'operator', disabled: false } })
    await prisma.user.updateMany({ where: { role: 'operator', disabled: false }, data: { disabled: true } })
    try {
      const target = await makeUser('operator', false)
      requireRoleMock.mockResolvedValueOnce({ userId: 'someone-else', role: 'operator' })
      const res = await PATCH(patchReq({ action: 'disable' }), { params: { id: target.id } })
      expect(res.status).toBe(400)
    } finally {
      const ids = others.map((o) => o.id)
      if (ids.length) await prisma.user.updateMany({ where: { id: { in: ids } }, data: { disabled: false } })
    }
  })

  it('存在另一名可用运营时可正常禁用', async () => {
    const other = await makeUser('operator', false)
    const target = await makeUser('operator', false)
    requireRoleMock.mockResolvedValueOnce({ userId: 'someone-else', role: 'operator' })
    const res = await PATCH(patchReq({ action: 'disable' }), { params: { id: target.id } })
    expect(res.status).toBe(200)
    expect((await prisma.user.findUnique({ where: { id: target.id } }))?.disabled).toBe(true)
    void other
  })

  it('删除最后一名可用运营 → 400', async () => {
    const others = await prisma.user.findMany({ where: { role: 'operator', disabled: false } })
    await prisma.user.updateMany({ where: { role: 'operator', disabled: false }, data: { disabled: true } })
    try {
      const target = await makeUser('operator', false)
      requireRoleMock.mockResolvedValueOnce({ userId: 'someone-else', role: 'operator' })
      const res = await DELETE(delReq(), { params: { id: target.id } })
      expect(res.status).toBe(400)
      expect(await prisma.user.findUnique({ where: { id: target.id } })).not.toBeNull()
    } finally {
      const ids = others.map((o) => o.id)
      if (ids.length) await prisma.user.updateMany({ where: { id: { in: ids } }, data: { disabled: false } })
    }
  })

  it('重置自己密码也拦截（不能操作自己）', async () => {
    const self = await makeUser('operator')
    requireRoleMock.mockResolvedValueOnce({ userId: self.id, role: 'operator' })
    const res = await PATCH(patchReq({ action: 'reset', password: 'password123' }), { params: { id: self.id } })
    expect(res.status).toBe(400)
  })

  it('重置他人运营密码正常', async () => {
    const target = await makeUser('operator')
    requireRoleMock.mockResolvedValueOnce({ userId: 'someone-else', role: 'operator' })
    const res = await PATCH(patchReq({ action: 'reset', password: 'newpassword123' }), { params: { id: target.id } })
    expect(res.status).toBe(200)
  })
})

afterAll(async () => {
  for (const email of cleanupEmails) await prisma.user.deleteMany({ where: { email } })
  await prisma.$disconnect()
})
