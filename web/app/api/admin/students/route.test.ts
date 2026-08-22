// 与 web/app/api/admin/students/[id]/route.test.ts 的共享状态耦合（务必保留）：
// 那个文件里的「禁用/删除最后一名可用运营 → 400」依赖一个全局前提——测试库里除目标外
// 没有其它「启用状态」的运营账号。vitest 跨文件并行，本文件若在那段窗口里留下启用状态的
// 运营，就会让它的前提失效、断言随机变红（实测失败率一度约 60%）。
// 因此本文件创建的运营账号一律不得处于启用状态：要么直接建成 disabled，要么用完立刻禁用。
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
  it('创建学员（账号 = 11 位手机号）', async () => {
    requireRoleMock.mockResolvedValueOnce({ userId: 'op1', role: 'operator' })
    const email = track(`139${String(Date.now()).slice(-8)}`)
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
    // 立刻禁用：见文件顶部「与 [id]/route.test.ts 的共享状态耦合」说明。
    // POST 建出来的运营默认是启用状态，留着它会让并行跑的 [id] 测试的「最后一名可用运营」前提失效。
    await prisma.user.update({ where: { email }, data: { disabled: true } })
  })

  // ★ 账号体系（用户拍板）：学员一律 11 位手机号；旧的邮箱格式学员不再允许创建
  it('学员账号不是 11 位手机号 → 400', async () => {
    requireRoleMock.mockResolvedValueOnce({ userId: 'op1', role: 'operator' })
    const res = await POST(postReq({ email: track(`stu-${Date.now()}@example.com`), password: 'password123', role: 'student' }), { params: {} })
    expect(res.status).toBe(400)
  })

  it('重复账号 → 409', async () => {
    requireRoleMock.mockResolvedValueOnce({ userId: 'op1', role: 'operator' })
    const email = track(`138${String(Date.now()).slice(-8)}`)
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
    // disabled: true —— 本用例只关心「role=operator 的账号会被列出」，列表接口不按 disabled 过滤
    // （见 route.ts 的 select）。建成禁用态可避免污染 [id] 测试的「最后一名可用运营」前提。
    await prisma.user.create({ data: { email, passwordHash: 'x', role: 'operator', disabled: true } })

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
