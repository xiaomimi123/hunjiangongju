import { describe, it, expect, vi, afterAll, beforeAll, afterEach } from 'vitest'
import { NextRequest } from 'next/server'
import os from 'os'
import path from 'path'
import fs from 'fs/promises'
import { randomUUID } from 'crypto'
import { prisma } from '@mixcut/db'
import { HttpError } from '@/lib/auth'

const tmpDataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'assets-id-route-test-'))
process.env.DATA_DIR = tmpDataDir

const requireRoleMock = vi.fn()
vi.mock('@/lib/auth', async () => {
  const actual = await vi.importActual<typeof import('@/lib/auth')>('@/lib/auth')
  return { ...actual, requireRole: (...args: unknown[]) => requireRoleMock(...args) }
})

const { PATCH, DELETE } = await import('./route')

// 与 ../route.test.ts 并发跑在同一张共享测试库表上：绝不能整表清空，只精确追踪本文件自己创建的行 id。
const createdIds: string[] = []

async function mkAsset(overrides: { name?: string; folder?: string | null } = {}) {
  const id = randomUUID()
  const rel = `assets/${id}.jpg`
  await fs.mkdir(path.join(tmpDataDir, 'assets'), { recursive: true })
  await fs.writeFile(path.join(tmpDataDir, rel), 'x')
  const row = await prisma.stockAsset.create({
    data: { id, kind: 'image', name: overrides.name ?? 'orig', folder: overrides.folder ?? null, fileUrl: `/api/files/${rel}` },
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
    await prisma.stockAsset.deleteMany({ where: { id: { in: createdIds.splice(0) } } })
  }
})

afterAll(async () => {
  await prisma.$disconnect()
  await fs.rm(tmpDataDir, { recursive: true, force: true })
})

describe('PATCH /api/admin/assets/[id]', () => {
  it('非 operator → 401/403', async () => {
    requireRoleMock.mockRejectedValueOnce(new HttpError(403, '无权限'))
    const res = await PATCH(jsonReq('http://localhost/x', 'PATCH', { name: 'a' }), { params: { id: 'nope' } })
    expect([401, 403]).toContain(res.status)
  })

  it('不存在 → 404', async () => {
    const res = await PATCH(jsonReq('http://localhost/x', 'PATCH', { name: 'a' }), { params: { id: 'nope' } })
    expect(res.status).toBe(404)
  })

  it('改名 → 200 且持久化', async () => {
    const a = await mkAsset({ name: '旧名' })
    const res = await PATCH(jsonReq('http://localhost/x', 'PATCH', { name: '新名' }), { params: { id: a.id } })
    expect(res.status).toBe(200)
    const updated = await prisma.stockAsset.findUnique({ where: { id: a.id } })
    expect(updated?.name).toBe('新名')
  })

  it('改文件夹为空字符串 → 视为移出文件夹（folder=null）', async () => {
    const a = await mkAsset({ folder: '旅行' })
    await PATCH(jsonReq('http://localhost/x', 'PATCH', { folder: '' }), { params: { id: a.id } })
    const updated = await prisma.stockAsset.findUnique({ where: { id: a.id } })
    expect(updated?.folder).toBeNull()
  })

  it('name 传空字符串 → 400（不允许改成空名）', async () => {
    const a = await mkAsset()
    const res = await PATCH(jsonReq('http://localhost/x', 'PATCH', { name: '   ' }), { params: { id: a.id } })
    expect(res.status).toBe(400)
  })
})

describe('DELETE /api/admin/assets/[id]', () => {
  it('删除记录并尽力删文件', async () => {
    const a = await mkAsset()
    const abs = path.join(tmpDataDir, a.fileUrl.replace(/^\/api\/files\//, ''))
    expect(await fs.stat(abs).then(() => true).catch(() => false)).toBe(true)

    const res = await DELETE(jsonReq('http://localhost/x', 'DELETE'), { params: { id: a.id } })
    expect(res.status).toBe(200)
    expect(await prisma.stockAsset.findUnique({ where: { id: a.id } })).toBeNull()
    expect(await fs.stat(abs).then(() => true).catch(() => false)).toBe(false)
  })

  it('不存在 → 404', async () => {
    const res = await DELETE(jsonReq('http://localhost/x', 'DELETE'), { params: { id: 'nope' } })
    expect(res.status).toBe(404)
  })
})
