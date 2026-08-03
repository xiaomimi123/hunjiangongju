import { describe, it, expect, vi, afterAll, beforeAll, afterEach } from 'vitest'
import { NextRequest } from 'next/server'
import os from 'os'
import path from 'path'
import fs from 'fs/promises'
import { randomUUID } from 'crypto'
import { prisma } from '@mixcut/db'
import { HttpError } from '@/lib/auth'

// 路由内部通过 DATA_DIR 常量落盘，需在导入路由前设好，指向临时目录（测试结束整体清理）。
const tmpDataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'bgm-route-test-'))
process.env.DATA_DIR = tmpDataDir

// 与 [id]/route.test.ts 并发跑在同一张共享测试库表上：绝不能用 deleteMany({}) 整表清空，只精确追踪本文件自己创建的行 id。
const RUN = randomUUID().slice(0, 8)
const createdIds: string[] = []

const requireRoleMock = vi.fn()
vi.mock('@/lib/auth', async () => {
  const actual = await vi.importActual<typeof import('@/lib/auth')>('@/lib/auth')
  return { ...actual, requireRole: (...args: unknown[]) => requireRoleMock(...args) }
})

const { GET, POST } = await import('./route')

function fileReq(fd: FormData, url = 'http://localhost/api/bgm') {
  return new NextRequest(url, { method: 'POST', body: fd })
}
function getReq(url = 'http://localhost/api/bgm') {
  return new NextRequest(url, { method: 'GET' })
}
async function upload(fd: FormData) {
  const res = await POST(fileReq(fd), { params: {} })
  if (res.status === 200) {
    const json = await res.clone().json()
    for (const b of Array.isArray(json) ? json : [json]) createdIds.push(b.id)
  }
  return res
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

describe('POST /api/bgm', () => {
  it('非 operator → 401/403', async () => {
    requireRoleMock.mockRejectedValueOnce(new HttpError(403, '无权限'))
    const fd = new FormData()
    fd.append('files', new File([Buffer.from('x')], 'a.mp3', { type: 'audio/mpeg' }))
    const res = await upload(fd)
    expect([401, 403]).toContain(res.status)
  })

  it('未选文件（新旧字段都没有）→ 400', async () => {
    const res = await upload(new FormData())
    expect(res.status).toBe(400)
  })

  it('批次中混入非法扩展名 → 整单 400，不写入任何记录/文件', async () => {
    const folder = `${RUN}-bad`
    const fd = new FormData()
    fd.append('files', new File([Buffer.from('ok')], 'good.mp3', { type: 'audio/mpeg' }))
    fd.append('files', new File([Buffer.from('bad')], 'bad.txt', { type: 'text/plain' }))
    fd.append('folder', folder)
    const res = await upload(fd)
    expect(res.status).toBe(400)
    expect(await prisma.bgmLibrary.count({ where: { folder } })).toBe(0)
    const bgmDir = path.join(tmpDataDir, 'bgm')
    const exists = await fs.stat(bgmDir).then(() => true).catch(() => false)
    expect(exists ? (await fs.readdir(bgmDir)).length : 0).toBe(0)
  })

  it('合法批次（多文件）→ 200 数组，name 为去扩展名文件名，folder/styleTag 落到每条记录', async () => {
    const folder = `${RUN}-legit`
    const fd = new FormData()
    fd.append('files', new File([Buffer.from('a')], 'song one.mp3', { type: 'audio/mpeg' }))
    fd.append('files', new File([Buffer.from('b')], 'song-two.wav', { type: 'audio/wav' }))
    fd.append('folder', folder)
    fd.append('styleTag', '治愈')
    const res = await upload(fd)
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(Array.isArray(json)).toBe(true)
    expect(json).toHaveLength(2)
    const names = json.map((b: { name: string }) => b.name).sort()
    expect(names).toEqual(['song one', 'song-two'])
    expect(json.every((b: { folder: string; styleTag: string }) => b.folder === folder && b.styleTag === '治愈')).toBe(true)
  })

  it('未填 folder → 记录 folder 为 null', async () => {
    const fd = new FormData()
    fd.append('files', new File([Buffer.from('a')], `${RUN}-noFolder.mp3`, { type: 'audio/mpeg' }))
    const res = await upload(fd)
    const json = await res.json()
    expect(json[0].folder).toBeNull()
  })

  it('兼容旧版单文件字段 file → 200 返回单条对象（非数组），name 取自文件名', async () => {
    const fd = new FormData()
    fd.append('file', new File([Buffer.from('legacy')], `${RUN}-legacy.mp3`, { type: 'audio/mpeg' }))
    fd.append('styleTag', '燃')
    const res = await upload(fd)
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(Array.isArray(json)).toBe(false)
    expect(json.id).toBeTruthy()
    expect(json.styleTag).toBe('燃')
    expect(json.name).toBe(`${RUN}-legacy`)
    expect(json.folder).toBeNull()
  })

  it('旧版单文件非音频扩展名 → 400', async () => {
    const fd = new FormData()
    fd.append('file', new File([Buffer.from('x')], `${RUN}-legacy.txt`, { type: 'text/plain' }))
    const res = await upload(fd)
    expect(res.status).toBe(400)
  })
})

describe('GET /api/bgm', () => {
  it('返回列表且包含 name/folder 字段', async () => {
    const folder = `${RUN}-getcheck`
    const fd = new FormData()
    fd.append('files', new File([Buffer.from('a')], `${RUN}-get.mp3`, { type: 'audio/mpeg' }))
    fd.append('folder', folder)
    await upload(fd)

    const all = await (await GET(getReq(), { params: {} })).json()
    const mine = all.find((b: { folder: string | null }) => b.folder === folder)
    expect(mine).toBeTruthy()
    expect(mine.name).toBe(`${RUN}-get`)
  })
})
