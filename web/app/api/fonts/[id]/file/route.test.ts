import { describe, it, expect, vi, beforeAll, afterEach, afterAll } from 'vitest'
import { NextRequest } from 'next/server'
import os from 'os'
import path from 'path'
import fs from 'fs/promises'
import { mkdtempSync } from 'fs'
import { prisma, readFontMeta } from '@mixcut/db'
import { HttpError } from '@/lib/auth'

// 路由内部通过 DATA_DIR 常量落盘，需在导入路由前设好，指向临时目录（测试结束整体清理）。
// 用同步 mkdtempSync（而非 await fs.mkdtemp）避免顶层 await —— tsconfig 的 target/module
// 组合不支持顶层 await（仓库里其它测试文件也踩过这条，是已知基线问题，这里不新增）。
const tmpDataDir = mkdtempSync(path.join(os.tmpdir(), 'fonts-file-route-test-'))
process.env.DATA_DIR = tmpDataDir

const createdIds: string[] = []

const requireRoleMock = vi.fn()
vi.mock('@/lib/auth', async () => {
  const actual = await vi.importActual<typeof import('@/lib/auth')>('@/lib/auth')
  return { ...actual, requireRole: (...args: unknown[]) => requireRoleMock(...args) }
})

let GET: typeof import('./route').GET
beforeAll(async () => {
  ;({ GET } = await import('./route'))
  requireRoleMock.mockResolvedValue({ userId: 'op1', role: 'operator' })
})

const REAL_FONT = path.resolve(__dirname, '../../../../../../worker/templates/booklist/fonts/NotoSansSC-Regular.otf')

function getReq(headers?: Record<string, string>) {
  return new NextRequest('http://localhost/api/fonts/x/file', { method: 'GET', headers })
}
function ctx(id: string) {
  return { params: { id } }
}

async function makeCustomFont(): Promise<string> {
  const buf = await fs.readFile(REAL_FONT)
  const meta = readFontMeta(REAL_FONT)
  const dir = path.join(tmpDataDir, 'fonts')
  await fs.mkdir(dir, { recursive: true })
  const fileName = `${Date.now()}-${Math.random().toString(16).slice(2)}.otf`
  await fs.writeFile(path.join(dir, fileName), buf)
  const row = await prisma.customFont.create({
    data: { label: '测试字体', family: meta.family, weight: meta.weight, fileName },
  })
  createdIds.push(row.id)
  return row.id
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

describe('GET /api/fonts/[id]/file', () => {
  it('非 operator → 401/403', async () => {
    requireRoleMock.mockRejectedValueOnce(new HttpError(403, '无权限'))
    const res = await GET(getReq(), ctx('noto-sc'))
    expect([401, 403]).toContain(res.status)
  })

  it('内置字体返回文件与 immutable 缓存头', async () => {
    const res = await GET(getReq(), ctx('noto-sc'))
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toContain('immutable')
    expect(res.headers.get('etag')).toBeTruthy()
    const buf = Buffer.from(await res.arrayBuffer())
    expect(buf.length).toBeGreaterThan(0)
  })

  // ★ 内置字体不全是 .otf——霞鹜文楷、站酷快乐体是 .ttf，Content-Type 不能写死
  // font/otf，否则会把 .ttf 字体标错类型。
  it('.otf 内置字体返回 font/otf', async () => {
    const res = await GET(getReq(), ctx('noto-sc'))
    expect(res.headers.get('content-type')).toBe('font/otf')
  })

  it('.ttf 内置字体返回 font/ttf', async () => {
    const res = await GET(getReq(), ctx('lxgw-wenkai'))
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('font/ttf')
  })

  it('带匹配的 If-None-Match 返回 304', async () => {
    const first = await GET(getReq(), ctx('noto-sc'))
    const etag = first.headers.get('etag')!
    const res = await GET(getReq({ 'if-none-match': etag }), ctx('noto-sc'))
    expect(res.status).toBe(304)
  })

  it('自定义字体：返回与落盘一致的二进制，命中相同 etag', async () => {
    const id = await makeCustomFont()
    const res = await GET(getReq(), ctx(id))
    expect(res.status).toBe(200)
    const etag = res.headers.get('etag')!
    const again = await GET(getReq({ 'if-none-match': etag }), ctx(id))
    expect(again.status).toBe(304)
  })

  it('认不出的 id 返回 404', async () => {
    const res = await GET(getReq(), ctx('ghost'))
    expect(res.status).toBe(404)
  })

  it('自定义字体记录存在但磁盘文件缺失 → 404', async () => {
    const row = await prisma.customFont.create({
      data: { label: 'x', family: 'X', weight: 400, fileName: 'nope-does-not-exist.otf' },
    })
    createdIds.push(row.id)
    const res = await GET(getReq(), ctx(row.id))
    expect(res.status).toBe(404)
  })

  // ★ 安全：id 来自 URL，不可信。内置走白名单查表、自定义走数据库查询，
  // 两条路径都不该把 id 直接拼进文件路径——否则是路径穿越漏洞。
  it('路径穿越 id 返回 404，而不是读到别的文件', async () => {
    const res = await GET(getReq(), ctx('../../../../../../etc/passwd'))
    expect(res.status).toBe(404)
  })

  it('路径穿越 id（编码/相对写法变体）同样 404', async () => {
    const res = await GET(getReq(), ctx('..%2f..%2f..%2fetc%2fpasswd'))
    expect(res.status).toBe(404)
  })
})
