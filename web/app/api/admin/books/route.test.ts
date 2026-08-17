import { describe, it, expect, vi, afterAll, beforeAll, afterEach } from 'vitest'
import { NextRequest } from 'next/server'
import { randomUUID } from 'crypto'
import { prisma } from '@mixcut/db'
import { HttpError } from '@/lib/auth'

// 与 [id]/route.test.ts 并发跑在同一张共享测试库表上：绝不能用 deleteMany({}) 整表清空
// （会连带删掉另一个文件此刻正在验证的行），只精确追踪并清理本文件自己创建的行 id。
const RUN = randomUUID().slice(0, 8)
const createdIds: string[] = []

const requireRoleMock = vi.fn()
vi.mock('@/lib/auth', async () => {
  const actual = await vi.importActual<typeof import('@/lib/auth')>('@/lib/auth')
  return { ...actual, requireRole: (...args: unknown[]) => requireRoleMock(...args) }
})

const { GET, POST } = await import('./route')

function jsonReq(url: string, method: string, body?: unknown) {
  return new NextRequest(url, {
    method,
    ...(body !== undefined ? { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } } : {}),
  })
}
function getReq(url = 'http://localhost/api/admin/books') {
  return new NextRequest(url, { method: 'GET' })
}
async function create(body: unknown) {
  const res = await POST(jsonReq('http://localhost/api/admin/books', 'POST', body), { params: {} })
  if (res.status === 200) {
    const json = await res.clone().json()
    createdIds.push(json.id)
  }
  return res
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

describe('POST /api/admin/books', () => {
  it('非 operator → 401/403', async () => {
    requireRoleMock.mockRejectedValueOnce(new HttpError(403, '无权限'))
    const res = await create({ title: `${RUN}-书`, author: '作者' })
    expect([401, 403]).toContain(res.status)
  })

  it('缺书名 → 400', async () => {
    const res = await create({ title: '', author: '作者' })
    expect(res.status).toBe(400)
  })

  it('缺作者 → 400', async () => {
    const res = await create({ title: `${RUN}-书`, author: '' })
    expect(res.status).toBe(400)
  })

  it('正常新增 → 200，source 为 manual，书名去除书名号并 trim', async () => {
    const res = await create({ title: `《${RUN}-活着》 `, author: ' 余华 ', theme: '文学' })
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.title).toBe(`${RUN}-活着`)
    expect(json.author).toBe('余华')
    expect(json.source).toBe('manual')
    expect(json.theme).toBe('文学')
  })

  it('重复 (title,author) → 409', async () => {
    const first = await create({ title: `${RUN}-重复书`, author: '作者甲' })
    expect(first.status).toBe(200)
    const second = await create({ title: `《${RUN}-重复书》`, author: ' 作者甲 ' })
    expect(second.status).toBe(409)
  })
})

describe('GET /api/admin/books', () => {
  it('非 operator → 401/403', async () => {
    requireRoleMock.mockRejectedValueOnce(new HttpError(403, '无权限'))
    const res = await GET(getReq(), { params: {} })
    expect([401, 403]).toContain(res.status)
  })

  it('?theme= 过滤书目；themes 清单不受过滤影响', async () => {
    const themeA = `${RUN}-心理`
    const themeB = `${RUN}-历史`
    await create({ title: `${RUN}-书A1`, author: '作者A', theme: themeA })
    await create({ title: `${RUN}-书A2`, author: '作者A', theme: themeA })
    await create({ title: `${RUN}-书B1`, author: '作者B', theme: themeB })

    const all = await (await GET(getReq(), { params: {} })).json()
    const mine = all.books.filter((b: { theme: string | null }) => b.theme === themeA || b.theme === themeB)
    expect(mine).toHaveLength(3)
    expect(all.themes).toContain(themeA)
    expect(all.themes).toContain(themeB)

    const filtered = await (await GET(getReq('http://localhost/api/admin/books?theme=' + encodeURIComponent(themeA)), { params: {} })).json()
    expect(filtered.books).toHaveLength(2)
    expect(filtered.books.every((b: { theme: string }) => b.theme === themeA)).toBe(true)
    expect(filtered.themes).toContain(themeB)
  })
})
