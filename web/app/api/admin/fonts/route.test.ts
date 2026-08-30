import { describe, it, expect, vi, beforeAll, afterEach, afterAll } from 'vitest'
import { NextRequest } from 'next/server'
import os from 'os'
import path from 'path'
import fs from 'fs/promises'
import { mkdtempSync } from 'fs'
import { randomUUID } from 'crypto'
import { prisma } from '@mixcut/db'
import { HttpError } from '@/lib/auth'

// 路由内部通过 DATA_DIR 常量落盘，需在导入路由前设好，指向临时目录（测试结束整体清理）。
// 用同步 mkdtempSync（而非 await fs.mkdtemp）避免顶层 await —— tsconfig 的 target/module
// 组合不支持顶层 await（仓库里其它测试文件也踩过这条，是已知基线问题，这里不新增）。
const tmpDataDir = mkdtempSync(path.join(os.tmpdir(), 'fonts-route-test-'))
process.env.DATA_DIR = tmpDataDir

const createdIds: string[] = []

const requireRoleMock = vi.fn()
vi.mock('@/lib/auth', async () => {
  const actual = await vi.importActual<typeof import('@/lib/auth')>('@/lib/auth')
  return { ...actual, requireRole: (...args: unknown[]) => requireRoleMock(...args) }
})

let GET: typeof import('./route').GET
let POST: typeof import('./route').POST
let DELETE: typeof import('./[id]/route').DELETE
beforeAll(async () => {
  ;({ GET, POST } = await import('./route'))
  ;({ DELETE } = await import('./[id]/route'))
  requireRoleMock.mockResolvedValue({ userId: 'op1', role: 'operator' })
})

const REAL_FONT = path.resolve(__dirname, '../../../../../worker/templates/booklist/fonts/NotoSansSC-Regular.otf')

function fileReq(fd: FormData, url = 'http://localhost/api/admin/fonts') {
  return new NextRequest(url, { method: 'POST', body: fd })
}
function getReq(url = 'http://localhost/api/admin/fonts') {
  return new NextRequest(url, { method: 'GET' })
}
async function upload(fd: FormData) {
  const res = await POST(fileReq(fd), { params: {} })
  if (res.status === 200) {
    const json = await res.clone().json()
    createdIds.push(json.id)
  }
  return res
}
async function fontsDirFiles(): Promise<string[]> {
  const dir = path.join(tmpDataDir, 'fonts')
  return fs.stat(dir).then(() => fs.readdir(dir)).catch(() => [])
}

afterEach(async () => {
  if (createdIds.length) {
    await prisma.customFont.deleteMany({ where: { id: { in: createdIds.splice(0) } } })
  }
})

afterAll(async () => {
  await prisma.$disconnect()
  await fs.rm(tmpDataDir, { recursive: true, force: true })
})

describe('POST /api/admin/fonts', () => {
  it('非 operator → 401/403', async () => {
    requireRoleMock.mockRejectedValueOnce(new HttpError(403, '无权限'))
    const fd = new FormData()
    fd.append('file', new File([Buffer.from('x')], 'a.ttf'))
    const res = await upload(fd)
    expect([401, 403]).toContain(res.status)
  })

  it('非 ttf/otf 拒收', async () => {
    const fd = new FormData()
    fd.append('file', new File([Buffer.from('nope')], 'x.png'))
    const res = await upload(fd)
    expect(res.status).toBe(400)
  })

  it('超过 30MB 拒收', async () => {
    const fd = new FormData()
    fd.append('file', new File([Buffer.alloc(31 * 1024 * 1024)], 'big.ttf'))
    const res = await upload(fd)
    expect(res.status).toBe(400)
  })

  it('族名解析不出时拒收，且不落盘（不留孤儿文件）', async () => {
    const fd = new FormData()
    fd.append('file', new File([Buffer.from('not a font')], 'fake.ttf'))
    const res = await upload(fd)
    expect(res.status).toBe(400)
    expect(await fontsDirFiles()).toEqual([])
  })

  it('合法字体落盘并入库，family 与 weight 来自解析而非文件名/用户输入', async () => {
    const buf = await fs.readFile(REAL_FONT)
    const fd = new FormData()
    fd.append('file', new File([buf], '随便起的名.otf'))
    fd.append('label', '思源黑体')
    const res = await upload(fd)
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.family).toBe('Noto Sans SC')
    expect(json.weight).toBe(400)
    expect(json.label).toBe('思源黑体')

    const files = await fontsDirFiles()
    expect(files).toHaveLength(1)
    // 落盘文件名是随机 uuid，不是用户提供的原始文件名
    expect(files[0]).not.toContain('随便起的名')

    const row = await prisma.customFont.findUniqueOrThrow({ where: { id: json.id } })
    expect(row.family).toBe('Noto Sans SC')
    expect(row.weight).toBe(400)
  })

  it('label 留空时用解析出的 family 兜底', async () => {
    const buf = await fs.readFile(REAL_FONT)
    const fd = new FormData()
    fd.append('file', new File([buf], 'x.otf'))
    const res = await upload(fd)
    const json = await res.json()
    expect(json.label).toBe('Noto Sans SC')
  })

  it('label 超过 40 字截断', async () => {
    const buf = await fs.readFile(REAL_FONT)
    const fd = new FormData()
    fd.append('file', new File([buf], 'x.otf'))
    fd.append('label', 'A'.repeat(60))
    const res = await upload(fd)
    const json = await res.json()
    expect(json.label).toHaveLength(40)
  })
})

describe('GET /api/admin/fonts', () => {
  it('返回内置字体清单与自定义字体清单', async () => {
    const buf = await fs.readFile(REAL_FONT)
    const fd = new FormData()
    fd.append('file', new File([buf], 'x.otf'))
    fd.append('label', 'GET测试字体')
    await upload(fd)

    const res = await GET(getReq(), { params: {} })
    const json = await res.json()
    expect(json.builtin.length).toBeGreaterThan(0)
    expect(json.builtin[0]).toHaveProperty('id')
    expect(json.builtin[0]).toHaveProperty('family')
    const mine = json.custom.find((c: { label: string }) => c.label === 'GET测试字体')
    expect(mine).toBeTruthy()
    expect(mine.family).toBe('Noto Sans SC')
  })
})

describe('DELETE /api/admin/fonts/[id]', () => {
  it('删不存在的 id 也返回 ok（幂等，与 BGM 删除同口径）', async () => {
    const res = await DELETE(new NextRequest('http://localhost/x', { method: 'DELETE' }), { params: { id: 'ghost' } })
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.ok).toBe(true)
  })

  it('删除存在的记录，同时删磁盘文件', async () => {
    const buf = await fs.readFile(REAL_FONT)
    const fd = new FormData()
    fd.append('file', new File([buf], 'x.otf'))
    const uploadRes = await upload(fd)
    const { id } = await uploadRes.json()
    const row = await prisma.customFont.findUniqueOrThrow({ where: { id } })
    const abs = path.join(tmpDataDir, 'fonts', row.fileName)
    expect(await fs.stat(abs).then(() => true).catch(() => false)).toBe(true)

    const res = await DELETE(new NextRequest('http://localhost/x', { method: 'DELETE' }), { params: { id } })
    expect(res.status).toBe(200)
    expect(await prisma.customFont.findUnique({ where: { id } })).toBeNull()
    expect(await fs.stat(abs).then(() => true).catch(() => false)).toBe(false)
    createdIds.splice(createdIds.indexOf(id), 1)
  })
})
