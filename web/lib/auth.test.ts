import { describe, it, expect, vi, afterAll, beforeAll, beforeEach } from 'vitest'
import bcrypt from 'bcryptjs'
import { prisma } from '@mixcut/db'
import { signToken } from './jwt'

// requireRole 通过 next/headers 的 cookies() 读 token；用一个可变的模块级变量控制每个测试
// 请求带的 cookie 值，避免真的搭一个 NextRequest/上下文。
let currentToken: string | undefined
vi.mock('next/headers', () => ({
  cookies: () => ({ get: (name: string) => (name === 'token' && currentToken ? { value: currentToken } : undefined) }),
}))

// 用 beforeAll + 动态 import 而非顶层 await：tsconfig 的 target/module 组合不支持顶层
// await（仓库其它测试文件同样的写法，见 web/app/api/admin/fonts/route.test.ts）。
let requireRole: typeof import('./auth').requireRole
let HttpError: typeof import('./auth').HttpError
beforeAll(async () => {
  ;({ requireRole, HttpError } = await import('./auth'))
})

const cleanupEmails: string[] = []
async function makeUser(opts: { role?: string; disabled?: boolean; sessionEpoch?: number } = {}) {
  const email = `auth-route-test-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`
  cleanupEmails.push(email)
  return prisma.user.create({
    data: {
      email,
      passwordHash: await bcrypt.hash('password123', 10),
      role: opts.role ?? 'student',
      disabled: opts.disabled ?? false,
      sessionEpoch: opts.sessionEpoch ?? 0,
    },
  })
}

beforeEach(() => {
  currentToken = undefined
})

afterAll(async () => {
  if (cleanupEmails.length) {
    await prisma.user.deleteMany({ where: { email: { in: cleanupEmails } } })
  }
})

describe('requireRole — 会话代次 / 禁用回查数据库', () => {
  it('存量会话兼容：token 没有 epoch claim + 用户 sessionEpoch=0 → 仍然通过（最重要的一条）', async () => {
    const u = await makeUser({ sessionEpoch: 0 })
    // 手写一个没有 epoch claim 的 token，模拟部署前签发的存量 token。
    // secret 取自与 jwt.ts 相同的环境变量（JWT_SECRET，见 .env），不能硬编码 'dev-secret'。
    const { SignJWT } = await import('jose')
    const secret = new TextEncoder().encode(process.env.JWT_SECRET ?? 'dev-secret')
    currentToken = await new SignJWT({ userId: u.id, role: u.role })
      .setProtectedHeader({ alg: 'HS256' })
      .setExpirationTime('7d')
      .sign(secret)

    const s = await requireRole()
    expect(s.userId).toBe(u.id)
  })

  it('改密码后：旧 token（epoch=0）+ 用户 sessionEpoch=1 → 401', async () => {
    const u = await makeUser({ sessionEpoch: 0 })
    currentToken = await signToken({ userId: u.id, role: u.role, epoch: 0 })
    // 模拟改密码：sessionEpoch +1
    await prisma.user.update({ where: { id: u.id }, data: { sessionEpoch: { increment: 1 } } })

    await expect(requireRole()).rejects.toMatchObject({ status: 401 })
  })

  it('改密码后：新 token（epoch=1）+ 用户 sessionEpoch=1 → 通过', async () => {
    const u = await makeUser({ sessionEpoch: 1 })
    currentToken = await signToken({ userId: u.id, role: u.role, epoch: 1 })
    const s = await requireRole()
    expect(s.userId).toBe(u.id)
  })

  it('禁用后：disabled=true → 401', async () => {
    const u = await makeUser({ disabled: true })
    currentToken = await signToken({ userId: u.id, role: u.role, epoch: 0 })
    await expect(requireRole()).rejects.toMatchObject({ status: 401 })
  })

  it('角色以数据库为准：token 里写 operator 但库里是 student → requireRole("operator") 应拒绝', async () => {
    const u = await makeUser({ role: 'student' })
    currentToken = await signToken({ userId: u.id, role: 'operator', epoch: 0 })
    await expect(requireRole('operator')).rejects.toMatchObject({ status: 403 })
  })

  it('角色以数据库为准：token 里写 student 但库里是 operator → requireRole("operator") 应通过', async () => {
    const u = await makeUser({ role: 'operator' })
    currentToken = await signToken({ userId: u.id, role: 'student', epoch: 0 })
    const s = await requireRole('operator')
    expect(s.role).toBe('operator')
  })

  it('用户被删：token 有效但库里查不到 → 401', async () => {
    const u = await makeUser()
    currentToken = await signToken({ userId: u.id, role: u.role, epoch: 0 })
    await prisma.user.delete({ where: { id: u.id } })
    cleanupEmails.splice(cleanupEmails.indexOf(u.email), 1)
    await expect(requireRole()).rejects.toMatchObject({ status: 401 })
  })

  it('未登录（无 cookie）→ 401', async () => {
    currentToken = undefined
    await expect(requireRole()).rejects.toBeInstanceOf(HttpError)
    await expect(requireRole()).rejects.toMatchObject({ status: 401 })
  })
})
