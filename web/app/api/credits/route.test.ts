// 本文件独占 site_config 单例行（id=1）：/api/credits 与 /api/admin/recharge-qr 的测试
// 都要写它，若拆成两个文件，vitest 跨文件并行会互踩单例导致随机变红——所以合在一处顺序跑。
// 将来任何新测试文件都不得写 site_config。
import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest'
import { NextRequest } from 'next/server'
import os from 'os'
import path from 'path'
import fs from 'fs/promises'
import { mkdtempSync } from 'fs'
import { prisma } from '@mixcut/db'

// /api/admin/recharge-qr 落盘用的 DATA_DIR 在模块顶层读一次 process.env.DATA_DIR，
// 必须在 import 该路由之前设好、且指向真实存在的临时目录 —— 本机没有 /data，
// 用法同 web/app/api/admin/fonts/route.test.ts。
const tmpDataDir = mkdtempSync(path.join(os.tmpdir(), 'credits-route-test-'))
process.env.DATA_DIR = tmpDataDir

const requireRoleMock = vi.fn()
vi.mock('@/lib/auth', async () => {
  const actual = await vi.importActual<typeof import('@/lib/auth')>('@/lib/auth')
  return { ...actual, requireRole: (...args: unknown[]) => requireRoleMock(...args) }
})

const { GET } = await import('./route')
const qr = await import('../admin/recharge-qr/route')

const userIds: string[] = []
afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: { in: userIds } } })
  await prisma.$disconnect()
  await fs.rm(tmpDataDir, { recursive: true, force: true })
})
beforeEach(() => { requireRoleMock.mockReset() })

const setQr = (rechargeQrUrl: string) =>
  prisma.siteConfig.upsert({ where: { id: 1 }, update: { rechargeQrUrl }, create: { id: 1, rechargeQrUrl } })

describe('GET /api/credits — 学员积分与充值二维码', () => {
  it('返回当前学员余额与二维码地址', async () => {
    const u = await prisma.user.create({
      data: { email: `1${String(Date.now()).slice(-7)}c01`, passwordHash: 'x', role: 'student', credits: 7 },
    })
    userIds.push(u.id)
    await setQr('/api/files/recharge/qr-test.png')
    requireRoleMock.mockResolvedValue({ userId: u.id, role: 'student' })
    const res = await GET(new NextRequest('http://localhost/api/credits'), { params: {} })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ credits: 7, qrUrl: '/api/files/recharge/qr-test.png' })
  })

  it('未配置二维码 → qrUrl 为空串；账号已删 → credits 为 0', async () => {
    await setQr('')
    requireRoleMock.mockResolvedValue({ userId: 'no-such-user', role: 'student' })
    const res = await GET(new NextRequest('http://localhost/api/credits'), { params: {} })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ credits: 0, qrUrl: '' })
  })
})

describe('充值二维码配置（/api/admin/recharge-qr）', () => {
  beforeEach(() => { requireRoleMock.mockResolvedValue({ userId: 'op-qr', role: 'operator' }) })

  it('上传图片 → 保存并可读回；删除 → 清空', async () => {
    const form = new FormData()
    form.set('file', new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], 'qr.png', { type: 'image/png' }))
    const up = await qr.POST(new NextRequest('http://localhost/x', { method: 'POST', body: form }), { params: {} })
    expect(up.status).toBe(200)
    const { qrUrl } = await up.json()
    expect(qrUrl).toMatch(/^\/api\/files\/recharge\//)
    expect((await prisma.siteConfig.findUnique({ where: { id: 1 } }))?.rechargeQrUrl).toBe(qrUrl)

    const got = await qr.GET(new NextRequest('http://localhost/x'), { params: {} })
    expect((await got.json()).qrUrl).toBe(qrUrl)

    const del = await qr.DELETE(new NextRequest('http://localhost/x', { method: 'DELETE' }), { params: {} })
    expect(del.status).toBe(200)
    expect((await prisma.siteConfig.findUnique({ where: { id: 1 } }))?.rechargeQrUrl).toBe('')
  })

  it('非图片扩展名 → 400', async () => {
    const form = new FormData()
    form.set('file', new File([new Uint8Array([1])], 'evil.svg', { type: 'image/svg+xml' }))
    const res = await qr.POST(new NextRequest('http://localhost/x', { method: 'POST', body: form }), { params: {} })
    expect(res.status).toBe(400)
  })
})
