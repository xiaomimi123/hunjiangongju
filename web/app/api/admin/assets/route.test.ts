import { describe, it, expect, vi, afterAll, beforeAll, afterEach } from 'vitest'
import { NextRequest } from 'next/server'
import os from 'os'
import path from 'path'
import fs from 'fs/promises'
import { randomUUID } from 'crypto'
import { prisma } from '@mixcut/db'
import { HttpError } from '@/lib/auth'

// 路由内部通过 DATA_DIR 常量落盘，需在导入路由前设好，指向临时目录（测试结束整体清理）。
const tmpDataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'assets-route-test-'))
process.env.DATA_DIR = tmpDataDir

// 本文件与 [id]/route.test.ts 并发跑在同一张共享测试库表上：绝不能用 deleteMany({}) 整表清空
// （会连带删掉另一个文件此刻正在验证的行），只精确追踪并清理本文件自己创建的行 id。
const RUN = randomUUID().slice(0, 8)
const createdIds: string[] = []

const requireRoleMock = vi.fn()
vi.mock('@/lib/auth', async () => {
  const actual = await vi.importActual<typeof import('@/lib/auth')>('@/lib/auth')
  return { ...actual, requireRole: (...args: unknown[]) => requireRoleMock(...args) }
})

const { GET, POST } = await import('./route')

function fileReq(fd: FormData, url = 'http://localhost/api/admin/assets') {
  return new NextRequest(url, { method: 'POST', body: fd })
}
function getReq(url = 'http://localhost/api/admin/assets') {
  return new NextRequest(url, { method: 'GET' })
}
async function upload(fd: FormData) {
  const res = await POST(fileReq(fd), { params: {} })
  if (res.status === 200) {
    const json = await res.clone().json()
    for (const a of json.created ?? []) createdIds.push(a.id)
  }
  return res
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

describe('POST /api/admin/assets', () => {
  it('非 operator → 401/403', async () => {
    requireRoleMock.mockRejectedValueOnce(new HttpError(403, '无权限'))
    const fd = new FormData()
    fd.append('files', new File([Buffer.from('x')], 'a.jpg', { type: 'image/jpeg' }))
    const res = await upload(fd)
    expect([401, 403]).toContain(res.status)
  })

  it('未选文件 → 400', async () => {
    const res = await upload(new FormData())
    expect(res.status).toBe(400)
  })

  it('批次中混入非法扩展名 → 整单 400，不写入任何记录/文件', async () => {
    const folder = `${RUN}-bad`
    const fd = new FormData()
    fd.append('files', new File([Buffer.from('ok')], 'good.jpg', { type: 'image/jpeg' }))
    fd.append('files', new File([Buffer.from('bad')], 'bad.txt', { type: 'text/plain' }))
    fd.append('folder', folder)
    const res = await upload(fd)
    expect(res.status).toBe(400)
    expect(await prisma.stockAsset.count({ where: { folder } })).toBe(0)
    const assetsDir = path.join(tmpDataDir, 'assets')
    const exists = await fs.stat(assetsDir).then(() => true).catch(() => false)
    expect(exists ? (await fs.readdir(assetsDir)).length : 0).toBe(0)
  })

  it('合法批次（图片+视频）→ 200，按扩展名分类 kind，name 为去扩展名文件名', async () => {
    const folder = `${RUN}-legit`
    const fd = new FormData()
    fd.append('files', new File([Buffer.from('img')], 'photo one.jpg', { type: 'image/jpeg' }))
    fd.append('files', new File([Buffer.from('vid')], 'clip.mp4', { type: 'video/mp4' }))
    fd.append('folder', folder)
    const res = await upload(fd)
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.created).toHaveLength(2)
    const kinds = json.created.map((a: { kind: string }) => a.kind).sort()
    expect(kinds).toEqual(['image', 'video'])
    const names = json.created.map((a: { name: string }) => a.name).sort()
    expect(names).toEqual(['clip', 'photo one'])
    expect(json.created.every((a: { folder: string }) => a.folder === folder)).toBe(true)
  })

  it('未填 folder → 记录 folder 为 null', async () => {
    const fd = new FormData()
    fd.append('files', new File([Buffer.from('img')], `${RUN}-noFolder.png`, { type: 'image/png' }))
    const res = await upload(fd)
    const json = await res.json()
    expect(json.created[0].folder).toBeNull()
  })
})

describe('GET /api/admin/assets', () => {
  it('返回全部素材与去重 folders 清单；?folder= 过滤素材但 folders 清单不受过滤影响', async () => {
    const folderA = `${RUN}-旅行`
    const folderB = `${RUN}-治愈`
    const mk = (folder: string | null) => {
      const fd = new FormData()
      fd.append('files', new File([Buffer.from('img')], `${randomUUID()}.jpg`, { type: 'image/jpeg' }))
      if (folder) fd.append('folder', folder)
      return upload(fd)
    }
    await mk(folderA)
    await mk(folderA)
    await mk(folderB)
    await mk(null)

    // 与其它并发测试文件共享同一张表，不能断言"总数恰好为 N"；只断言本次打了 RUN 标记的行都在场。
    const all = await (await GET(getReq(), { params: {} })).json()
    const mine = all.assets.filter((a: { folder: string | null }) => a.folder === folderA || a.folder === folderB)
    expect(mine).toHaveLength(3)
    expect(all.folders).toContain(folderA)
    expect(all.folders).toContain(folderB)

    const filtered = await (await GET(getReq('http://localhost/api/admin/assets?folder=' + encodeURIComponent(folderA)), { params: {} })).json()
    expect(filtered.assets).toHaveLength(2)
    expect(filtered.assets.every((a: { folder: string }) => a.folder === folderA)).toBe(true)
    // folders 清单不受 ?folder= 过滤影响：仍应包含 folderB
    expect(filtered.folders).toContain(folderB)
  })

  // ★ 原先无分页:素材上千张时一次性查完、传完整 JSON、渲染上千个 <img>,
  // 还会连带触发上千个缩略图请求 —— 页面与整个后台都会卡(web 是单进程 Node)。
  it('游标翻页:逐页取完且不重不漏', async () => {
    const folder = `${RUN}-分页`
    // 造 5 张;每页取 2 张来验游标(PAGE_SIZE 是 60,测试里用小文件夹逐页拿)
    for (let i = 0; i < 5; i++) {
      const fd = new FormData()
      fd.append('files', new File([Buffer.from('img')], `${randomUUID()}.jpg`, { type: 'image/jpeg' }))
      fd.append('folder', folder)
      await upload(fd)
    }
    const q = (cursor?: string) =>
      `http://localhost/api/admin/assets?folder=${encodeURIComponent(folder)}${cursor ? `&cursor=${cursor}` : ''}`

    // 一页装得下 5 张(PAGE_SIZE=60),所以不该给出 nextCursor
    const first = await (await GET(getReq(q()), { params: {} })).json()
    expect(first.assets).toHaveLength(5)
    expect(first.nextCursor, '一页装得下时不该给游标').toBeUndefined()

    // 用第一条当游标往后翻:应恰好拿到剩下 4 条,且不含游标那条本身(skip:1)
    const second = await (await GET(getReq(q(first.assets[0].id)), { params: {} })).json()
    const ids = second.assets.map((a: { id: string }) => a.id)
    expect(ids).toHaveLength(4)
    expect(ids, '游标那条不该重复出现').not.toContain(first.assets[0].id)
    // 两页合起来正好是全部 5 条,不重不漏
    expect(new Set([first.assets[0].id, ...ids]).size).toBe(5)
  })

  // 剪映一次导入十几张素材是在同一个循环里写的,createdAt 撞到同一毫秒很常见。
  // 这条验的是这种数据下逐条翻页依然不重不漏。
  //
  // 注:本以为它能守住 orderBy 里的 id 兜底定序,实测**守不住** —— 去掉 id 后仍然全绿,
  // 因为 Prisma 的游标分页内部已把游标字段纳入比较。id 兜底留着只是为了行序稳定,
  // 不是正确性必需。写在这里免得后人以为这条断言在保护它。
  it('createdAt 完全相同的一批素材,游标翻页仍不重不漏', async () => {
    const folder = `${RUN}-同秒`
    const at = new Date('2026-08-21T12:00:00.000Z')
    const ids: string[] = []
    for (let i = 0; i < 6; i++) {
      const row = await prisma.stockAsset.create({
        data: { kind: 'image', name: `同秒${i}`, folder, fileUrl: `/api/files/assets/${randomUUID()}.png`, createdAt: at },
      })
      ids.push(row.id)
      createdIds.push(row.id)
    }

    // 逐页翻(每次拿第一条当游标),把所有条目收集起来
    const seen: string[] = []
    let cursor: string | undefined
    for (let page = 0; page < 10; page++) {
      const url = `http://localhost/api/admin/assets?folder=${encodeURIComponent(folder)}${cursor ? `&cursor=${cursor}` : ''}`
      const r = await (await GET(getReq(url), { params: {} })).json()
      const pageIds: string[] = r.assets.map((a: { id: string }) => a.id)
      if (pageIds.length === 0) break
      // 每页只取第一条推进游标,模拟"逐条翻"这种最容易暴露定序不稳的走法
      seen.push(pageIds[0])
      cursor = pageIds[0]
      if (pageIds.length === 1) break
    }
    expect(new Set(seen).size, `逐条翻页出现重复: ${seen.join(',')}`).toBe(seen.length)
    expect(seen).toHaveLength(6)
    expect(new Set(seen)).toEqual(new Set(ids))
  })
})
