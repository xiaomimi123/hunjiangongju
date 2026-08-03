import { describe, it, expect, vi, afterAll, beforeAll, afterEach } from 'vitest'
import { NextRequest } from 'next/server'
import os from 'os'
import path from 'path'
import fs from 'fs/promises'
import { randomUUID } from 'crypto'
import { prisma } from '@mixcut/db'
import { HttpError } from '@/lib/auth'

const tmpDataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'bgm-id-route-test-'))
process.env.DATA_DIR = tmpDataDir

const requireRoleMock = vi.fn()
vi.mock('@/lib/auth', async () => {
  const actual = await vi.importActual<typeof import('@/lib/auth')>('@/lib/auth')
  return { ...actual, requireRole: (...args: unknown[]) => requireRoleMock(...args) }
})

const { PATCH, DELETE } = await import('./route')

// 与 ../route.test.ts 并发跑在同一张共享测试库表上：绝不能整表清空，只精确追踪本文件自己创建的行 id。
const createdIds: string[] = []

async function mkBgm(overrides: { name?: string | null; folder?: string | null; styleTag?: string | null } = {}) {
  const id = randomUUID()
  const rel = `bgm/${id}.mp3`
  await fs.mkdir(path.join(tmpDataDir, 'bgm'), { recursive: true })
  await fs.writeFile(path.join(tmpDataDir, rel), 'x')
  const row = await prisma.bgmLibrary.create({
    data: {
      id,
      fileUrl: `/api/files/${rel}`,
      name: overrides.name ?? '原名',
      folder: overrides.folder ?? null,
      styleTag: overrides.styleTag ?? null,
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
    await prisma.bgmLibrary.deleteMany({ where: { id: { in: createdIds.splice(0) } } })
  }
})

afterAll(async () => {
  await prisma.$disconnect()
  await fs.rm(tmpDataDir, { recursive: true, force: true })
})

describe('PATCH /api/bgm/[id]', () => {
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
    const b = await mkBgm({ name: '旧名' })
    const res = await PATCH(jsonReq('http://localhost/x', 'PATCH', { name: '新名' }), { params: { id: b.id } })
    expect(res.status).toBe(200)
    const updated = await prisma.bgmLibrary.findUnique({ where: { id: b.id } })
    expect(updated?.name).toBe('新名')
  })

  it('改文件夹为空字符串 → 视为移出文件夹（folder=null）', async () => {
    const b = await mkBgm({ folder: '抒情' })
    await PATCH(jsonReq('http://localhost/x', 'PATCH', { folder: '' }), { params: { id: b.id } })
    const updated = await prisma.bgmLibrary.findUnique({ where: { id: b.id } })
    expect(updated?.folder).toBeNull()
  })

  it('改 styleTag 为空字符串 → 视为清空（styleTag=null）', async () => {
    const b = await mkBgm({ styleTag: '燃' })
    await PATCH(jsonReq('http://localhost/x', 'PATCH', { styleTag: '' }), { params: { id: b.id } })
    const updated = await prisma.bgmLibrary.findUnique({ where: { id: b.id } })
    expect(updated?.styleTag).toBeNull()
  })

  it('name 传空字符串 → 400（不允许改成空名）', async () => {
    const b = await mkBgm()
    const res = await PATCH(jsonReq('http://localhost/x', 'PATCH', { name: '   ' }), { params: { id: b.id } })
    expect(res.status).toBe(400)
  })

  it('body 不含任何可改字段 → 400', async () => {
    const b = await mkBgm()
    const res = await PATCH(jsonReq('http://localhost/x', 'PATCH', {}), { params: { id: b.id } })
    expect(res.status).toBe(400)
  })
})

describe('DELETE /api/bgm/[id]', () => {
  it('删除记录并尽力删文件', async () => {
    const b = await mkBgm()
    const abs = path.join(tmpDataDir, b.fileUrl.replace(/^\/api\/files\//, ''))
    expect(await fs.stat(abs).then(() => true).catch(() => false)).toBe(true)

    const res = await DELETE(jsonReq('http://localhost/x', 'DELETE'), { params: { id: b.id } })
    expect(res.status).toBe(200)
    expect(await prisma.bgmLibrary.findUnique({ where: { id: b.id } })).toBeNull()
    expect(await fs.stat(abs).then(() => true).catch(() => false)).toBe(false)
  })

  it('不存在 → 404', async () => {
    const res = await DELETE(jsonReq('http://localhost/x', 'DELETE'), { params: { id: 'nope' } })
    expect(res.status).toBe(404)
  })
})
