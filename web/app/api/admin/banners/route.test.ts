import { describe, it, expect, vi, beforeAll, afterEach, afterAll } from 'vitest'
import { NextRequest } from 'next/server'
import { prisma } from '@mixcut/db'
import { HttpError } from '@/lib/auth'

const requireRoleMock = vi.fn()
vi.mock('@/lib/auth', async () => {
  const actual = await vi.importActual<typeof import('@/lib/auth')>('@/lib/auth')
  return { ...actual, requireRole: (...args: unknown[]) => requireRoleMock(...args) }
})

let GET: typeof import('./route').GET
let POST: typeof import('./route').POST
let PATCH: typeof import('./[id]/route').PATCH
let DELETE: typeof import('./[id]/route').DELETE
let studentGET: typeof import('../../banners/route').GET

beforeAll(async () => {
  ;({ GET, POST } = await import('./route'))
  ;({ PATCH, DELETE } = await import('./[id]/route'))
  ;({ GET: studentGET } = await import('../../banners/route'))
  requireRoleMock.mockResolvedValue({ userId: 'op1', role: 'operator' })
})

const createdBannerIds: string[] = []

afterEach(async () => {
  if (createdBannerIds.length) {
    await prisma.banner.deleteMany({ where: { id: { in: createdBannerIds.splice(0) } } })
  }
})

afterAll(async () => {
  await prisma.$disconnect()
})

function jsonReq(url: string, method: string, body?: unknown) {
  return new NextRequest(url, {
    method,
    ...(body !== undefined ? { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } } : {}),
  })
}

function getReq(url = 'http://localhost/api/admin/banners') {
  return new NextRequest(url, { method: 'GET' })
}

const VALID_BODY = {
  title: '暑期活动开启',
  body: '新学员注册即送 30 积分',
  linkUrl: '/activity',
  sortOrder: 1,
}

async function createBanner(body: Record<string, unknown> = VALID_BODY) {
  const res = await POST(jsonReq('http://localhost/api/admin/banners', 'POST', body), { params: {} })
  if (res.status === 200) {
    const json = await res.clone().json()
    createdBannerIds.push(json.id)
  }
  return res
}

describe('POST /api/admin/banners', () => {
  it('非 operator → 401/403', async () => {
    requireRoleMock.mockRejectedValueOnce(new HttpError(403, '无权限'))
    const res = await createBanner()
    expect([401, 403]).toContain(res.status)
  })

  it('title 超长 → 400', async () => {
    const res = await createBanner({ ...VALID_BODY, title: '一'.repeat(61) })
    expect(res.status).toBe(400)
  })

  it('title 为空 → 400', async () => {
    const res = await createBanner({ ...VALID_BODY, title: '' })
    expect(res.status).toBe(400)
  })

  it('body 超长 → 400', async () => {
    const res = await createBanner({ ...VALID_BODY, body: '一'.repeat(201) })
    expect(res.status).toBe(400)
  })

  it('linkUrl 不合法（非 / 开头、非 https） → 400', async () => {
    const res = await createBanner({ ...VALID_BODY, linkUrl: 'http://evil.com' })
    expect(res.status).toBe(400)
  })

  it('sortOrder 超范围 → 400', async () => {
    const res = await createBanner({ ...VALID_BODY, sortOrder: 1000 })
    expect(res.status).toBe(400)
  })

  it('sortOrder 非整数 → 400', async () => {
    const res = await createBanner({ ...VALID_BODY, sortOrder: 1.5 })
    expect(res.status).toBe(400)
  })

  it('合法创建 → 200，GET 回读一致', async () => {
    const res = await createBanner()
    expect(res.status).toBe(200)
    const created = await res.json()
    expect(created.title).toBe(VALID_BODY.title)
    expect(created.linkUrl).toBe(VALID_BODY.linkUrl)
    expect(created.enabled).toBe(true)

    const listRes = await GET(getReq(), { params: {} })
    const { banners } = await listRes.json()
    const mine = banners.find((b: { id: string }) => b.id === created.id)
    expect(mine).toBeTruthy()
    expect(mine.title).toBe(VALID_BODY.title)
  })
})

describe('PATCH /api/admin/banners/[id]', () => {
  it('非 operator → 401/403', async () => {
    const created = await (await createBanner()).json()
    requireRoleMock.mockRejectedValueOnce(new HttpError(403, '无权限'))
    const res = await PATCH(jsonReq('http://localhost/x', 'PATCH', { enabled: false }), { params: { id: created.id } })
    expect([401, 403]).toContain(res.status)
  })

  it('不存在 → 404', async () => {
    const res = await PATCH(jsonReq('http://localhost/x', 'PATCH', { enabled: true }), { params: { id: 'ghost' } })
    expect(res.status).toBe(404)
  })

  it('启停生效', async () => {
    const created = await (await createBanner()).json()
    expect(created.enabled).toBe(true)

    const downRes = await PATCH(jsonReq('http://localhost/x', 'PATCH', { enabled: false }), { params: { id: created.id } })
    expect(downRes.status).toBe(200)
    expect((await downRes.json()).enabled).toBe(false)

    const upRes = await PATCH(jsonReq('http://localhost/x', 'PATCH', { enabled: true }), { params: { id: created.id } })
    expect((await upRes.json()).enabled).toBe(true)
  })
})

describe('DELETE /api/admin/banners/[id]', () => {
  it('删除成功', async () => {
    const created = await (await createBanner()).json()
    const res = await DELETE(jsonReq('http://localhost/x', 'DELETE'), { params: { id: created.id } })
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.ok).toBe(true)
    expect(await prisma.banner.findUnique({ where: { id: created.id } })).toBeNull()
  })

  it('不存在 → 404', async () => {
    const res = await DELETE(jsonReq('http://localhost/x', 'DELETE'), { params: { id: 'ghost' } })
    expect(res.status).toBe(404)
  })
})

describe('GET /api/banners（学员端）', () => {
  it('只返回 enabled=true，且不含内部字段', async () => {
    const enabledBanner = await (await createBanner({ ...VALID_BODY, title: '启用中', sortOrder: 0 })).json()
    const disabledBanner = await (
      await createBanner({ ...VALID_BODY, title: '已禁用', sortOrder: 1, enabled: false })
    ).json()

    requireRoleMock.mockResolvedValueOnce({ userId: 'stu1', role: 'student' })
    const res = await studentGET(getReq('http://localhost/api/banners'), { params: {} })
    expect(res.status).toBe(200)
    const { banners } = await res.json()

    const ids = banners.map((b: { id: string }) => b.id)
    expect(ids).toContain(enabledBanner.id)
    expect(ids).not.toContain(disabledBanner.id)

    const mine = banners.find((b: { id: string }) => b.id === enabledBanner.id)
    expect(Object.keys(mine).sort()).toEqual(['id', 'title', 'body', 'linkUrl'].sort())
  })

  it('按 sortOrder asc, id asc 排序', async () => {
    const b2 = await (await createBanner({ ...VALID_BODY, title: 'B', sortOrder: 5 })).json()
    const b1 = await (await createBanner({ ...VALID_BODY, title: 'A', sortOrder: 2 })).json()

    requireRoleMock.mockResolvedValueOnce({ userId: 'stu1', role: 'student' })
    const res = await studentGET(getReq('http://localhost/api/banners'), { params: {} })
    const { banners } = await res.json()
    const ids = banners.map((b: { id: string }) => b.id).filter((id: string) => [b1.id, b2.id].includes(id))
    expect(ids).toEqual([b1.id, b2.id])
  })
})
