import { describe, it, expect, vi, afterAll, beforeAll } from 'vitest'
import { NextRequest } from 'next/server'
import os from 'os'
import path from 'path'
import fs from 'fs/promises'
import { prisma } from '@mixcut/db'
import { HttpError } from '@/lib/auth'

// 路由内部通过 DATA_DIR 常量落盘，需在导入路由前设好，指向临时目录（测试结束整体清理）。
const tmpDataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'jianying-import-route-test-'))
process.env.DATA_DIR = tmpDataDir

const requireRoleMock = vi.fn()
vi.mock('@/lib/auth', async () => {
  const actual = await vi.importActual<typeof import('@/lib/auth')>('@/lib/auth')
  return { ...actual, requireRole: (...args: unknown[]) => requireRoleMock(...args) }
})

const { POST } = await import('./route')

// 与其它 route.test.ts 并发跑在同一张共享测试库表上：绝不能用 deleteMany({}) 整表清空。
// 这里固定用了两个专属工程名，先在 beforeAll 做一次按 folder 精确清理，保证重跑幂等，
// 再全程只追踪本文件创建出来的 id 做 afterAll 清理。
const PROJECT = '导入测试工程'
const PROJECT2 = '导入测试工程2'
const createdBgm: string[] = []
const createdAssets: string[] = []
const createdFw: string[] = []

beforeAll(async () => {
  requireRoleMock.mockResolvedValue({ userId: 'op1', role: 'operator' })
  await prisma.bgmLibrary.deleteMany({ where: { folder: { in: [PROJECT, PROJECT2] } } })
  await prisma.stockAsset.deleteMany({ where: { folder: { in: [PROJECT, PROJECT2] } } })
})

afterAll(async () => {
  await prisma.bgmLibrary.deleteMany({ where: { id: { in: createdBgm } } })
  await prisma.stockAsset.deleteMany({ where: { id: { in: createdAssets } } })
  await prisma.copyFramework.deleteMany({ where: { id: { in: createdFw } } })
  await prisma.$disconnect()
  await fs.rm(tmpDataDir, { recursive: true, force: true })
})

function makeForm(over: Partial<Record<string, string>> = {}) {
  const form = new FormData()
  form.set('name', over.name ?? '导入测试框架')
  form.set('projectName', over.projectName ?? PROJECT)
  form.set('templateParams', over.templateParams ?? JSON.stringify({ mode: 'flash' }))
  form.set('bgmMeta', over.bgmMeta ?? JSON.stringify([{ fileName: 'song.mp3', title: '歌曲A' }]))
  form.append('bgmFiles', new File([new Uint8Array([1, 2, 3])], 'song.mp3', { type: 'audio/mpeg' }))
  form.append('imageFiles', new File([new Uint8Array([9, 9])], 'pic.png', { type: 'image/png' }))
  return form
}

function req(form: FormData) {
  return new NextRequest('http://localhost/api/admin/jianying/import', { method: 'POST', body: form })
}

async function call(form: FormData) {
  return POST(req(form), { params: {} })
}

describe('POST /api/admin/jianying/import', () => {
  it('非 operator → 401/403', async () => {
    requireRoleMock.mockRejectedValueOnce(new HttpError(403, '无权限'))
    const res = await call(makeForm())
    expect([401, 403]).toContain(res.status)
  })

  it('入库 BGM+素材,建框架并写默认值', async () => {
    const res = await call(makeForm())
    expect(res.status).toBe(200)
    const j = await res.json()
    createdFw.push(j.id)
    expect(j.bgm).toEqual({ imported: 1, reused: 0 })
    expect(j.assets).toEqual({ imported: 1, reused: 0 })
    const fw = await prisma.copyFramework.findUniqueOrThrow({ where: { id: j.id } })
    const ot = fw.overlayTemplate as Record<string, unknown>
    const bgm = await prisma.bgmLibrary.findFirstOrThrow({ where: { folder: PROJECT, name: '歌曲A' } })
    createdBgm.push(bgm.id)
    expect(ot.__defaultBgmId).toBe(bgm.id)
    expect(ot.__defaultAssetFolder).toBe(PROJECT)
    const asset = await prisma.stockAsset.findFirstOrThrow({ where: { folder: PROJECT, name: 'pic' } })
    createdAssets.push(asset.id)
    expect(asset.kind).toBe('image')
  })

  it('重复导入:媒体复用不重建,框架新建', async () => {
    const res = await call(makeForm())
    const j = await res.json()
    createdFw.push(j.id)
    expect(j.bgm).toEqual({ imported: 0, reused: 1 })
    expect(j.assets).toEqual({ imported: 0, reused: 1 })
    expect(await prisma.bgmLibrary.count({ where: { folder: PROJECT, name: '歌曲A' } })).toBe(1)
  })

  it('非法媒体扩展 → 400 且零写入', async () => {
    const form = makeForm({ projectName: PROJECT2 })
    form.append('imageFiles', new File([new Uint8Array([1])], 'evil.exe'))
    const res = await call(form)
    expect(res.status).toBe(400)
    expect(await prisma.stockAsset.count({ where: { folder: PROJECT2 } })).toBe(0)
    expect(await prisma.bgmLibrary.count({ where: { folder: PROJECT2 } })).toBe(0)
  })

  it('框架名为空 → 400', async () => {
    const res = await call(makeForm({ name: ' ' }))
    expect(res.status).toBe(400)
  })

  it('带 watermark/bodyCount → 落到 overlayTemplate.watermark 与 suggestedSegmentCount', async () => {
    const form = makeForm({ projectName: '导入测试工程3' })
    form.set('watermark', '@欧子好读')
    form.set('bodyCount', '4')
    const res = await call(form)
    expect(res.status).toBe(200)
    const j = await res.json()
    createdFw.push(j.id)
    const fw = await prisma.copyFramework.findUniqueOrThrow({ where: { id: j.id } })
    expect((fw.overlayTemplate as Record<string, unknown>).watermark).toBe('@欧子好读')
    expect(fw.suggestedSegmentCount).toBe(4)
  })

  it('不带这两个字段 → 与现状一致（不写入）', async () => {
    const res = await call(makeForm({ projectName: '导入测试工程4' }))
    const j = await res.json()
    createdFw.push(j.id)
    const fw = await prisma.copyFramework.findUniqueOrThrow({ where: { id: j.id } })
    expect((fw.overlayTemplate as Record<string, unknown>).watermark).toBeUndefined()
    expect(fw.suggestedSegmentCount).toBeNull()
  })
})
