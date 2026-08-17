import { describe, it, expect, vi, afterAll, beforeAll, afterEach } from 'vitest'
import { NextRequest } from 'next/server'
import { randomUUID } from 'crypto'
import { prisma } from '@mixcut/db'
import { HttpError } from '@/lib/auth'

const requireRoleMock = vi.fn()
vi.mock('@/lib/auth', async () => {
  const actual = await vi.importActual<typeof import('@/lib/auth')>('@/lib/auth')
  return { ...actual, requireRole: (...args: unknown[]) => requireRoleMock(...args) }
})

const { PATCH, DELETE } = await import('./route')

// 与 ../route.test.ts 并发跑在同一张共享测试库表上：绝不能整表清空，只精确追踪本文件自己创建的行 id。
const RUN = randomUUID().slice(0, 8)
const createdIds: string[] = []

async function mkBook(overrides: { title?: string; author?: string; theme?: string | null; points?: string | null; source?: string } = {}) {
  const row = await prisma.bookLibrary.create({
    data: {
      title: overrides.title ?? `${RUN}-原书名`,
      author: overrides.author ?? '原作者',
      theme: overrides.theme ?? null,
      points: overrides.points ?? null,
      source: overrides.source ?? 'ai',
    },
  })
  createdIds.push(row.id)
  return row
}

function jsonReq(url: string, method: string, body?: unknown) {
  return new NextRequest(url, {
    method,
    ...(body !== undefined ? { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } } : {}),
  })
}

beforeAll(() => {
  requireRoleMock.mockResolvedValue({ userId: 'op1', role: 'operator' })
})

afterEach(async () => {
  if (createdIds.length) {
    await prisma.bookLibrary.deleteMany({ where: { id: { in: createdIds.splice(0) } } })
  }
})

afterAll(async () => {
  await prisma.$disconnect()
})

describe('PATCH /api/admin/books/[id]', () => {
  it('非 operator → 401/403', async () => {
    requireRoleMock.mockRejectedValueOnce(new HttpError(403, '无权限'))
    const res = await PATCH(jsonReq('http://localhost/x', 'PATCH', { theme: '新主题' }), { params: { id: 'nope' } })
    expect([401, 403]).toContain(res.status)
  })

  it('不存在 → 404', async () => {
    const res = await PATCH(jsonReq('http://localhost/x', 'PATCH', { theme: '新主题' }), { params: { id: 'nope' } })
    expect(res.status).toBe(404)
  })

  it('改主题与要点 → 200 且持久化', async () => {
    const b = await mkBook()
    const res = await PATCH(jsonReq('http://localhost/x', 'PATCH', { theme: '心理成长', points: '要点一;要点二' }), { params: { id: b.id } })
    expect(res.status).toBe(200)
    const updated = await prisma.bookLibrary.findUnique({ where: { id: b.id } })
    expect(updated?.theme).toBe('心理成长')
    expect(updated?.points).toBe('要点一;要点二')
  })

  it('改书名 → 去除书名号并 trim，与 upsertBook 规范化一致', async () => {
    const b = await mkBook()
    const res = await PATCH(jsonReq('http://localhost/x', 'PATCH', { title: `《${RUN}-新书名》 ` }), { params: { id: b.id } })
    expect(res.status).toBe(200)
    const updated = await prisma.bookLibrary.findUnique({ where: { id: b.id } })
    expect(updated?.title).toBe(`${RUN}-新书名`)
  })

  it('改成已存在的 (title,author) 组合 → 409', async () => {
    const other = await mkBook({ title: `${RUN}-已占用书名`, author: '同名作者' })
    const b = await mkBook({ title: `${RUN}-待改书名`, author: '待改作者' })
    const res = await PATCH(jsonReq('http://localhost/x', 'PATCH', { title: other.title, author: other.author }), { params: { id: b.id } })
    expect(res.status).toBe(409)
  })

  it('title 传空字符串 → 400（不允许改成空书名）', async () => {
    const b = await mkBook()
    const res = await PATCH(jsonReq('http://localhost/x', 'PATCH', { title: '   ' }), { params: { id: b.id } })
    expect(res.status).toBe(400)
  })
})

describe('DELETE /api/admin/books/[id]', () => {
  it('非 operator → 401/403', async () => {
    requireRoleMock.mockRejectedValueOnce(new HttpError(403, '无权限'))
    const res = await DELETE(jsonReq('http://localhost/x', 'DELETE'), { params: { id: 'nope' } })
    expect([401, 403]).toContain(res.status)
  })

  it('删除记录', async () => {
    const b = await mkBook()
    const res = await DELETE(jsonReq('http://localhost/x', 'DELETE'), { params: { id: b.id } })
    expect(res.status).toBe(200)
    expect(await prisma.bookLibrary.findUnique({ where: { id: b.id } })).toBeNull()
  })

  it('不存在 → 404', async () => {
    const res = await DELETE(jsonReq('http://localhost/x', 'DELETE'), { params: { id: 'nope' } })
    expect(res.status).toBe(404)
  })
})
