// 积分定价接口：视频单价（SiteConfig）与生图单价（photo extra.pricePerImage）读写。
// 关键回归：改生图单价必须 merge 保留 extra 里的其他键（resolution 等），不能整包覆盖。
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import { NextRequest } from 'next/server'
import { prisma } from '@mixcut/db'

const requireRoleMock = vi.fn()
vi.mock('@/lib/auth', async () => {
  const actual = await vi.importActual<typeof import('@/lib/auth')>('@/lib/auth')
  return { ...actual, requireRole: (...args: unknown[]) => requireRoleMock(...args) }
})

let GET: typeof import('./route').GET
let PUT: typeof import('./route').PUT

beforeAll(async () => {
  ;({ GET, PUT } = await import('./route'))
  requireRoleMock.mockResolvedValue({ userId: 'op1', role: 'operator' })
})

afterAll(async () => {
  // 恢复现场：这两处都是全局单行配置，脏着离开会污染后续/并行用例
  await prisma.siteConfig.upsert({ where: { id: 1 }, update: { videoPriceCc: 100 }, create: { id: 1 } })
  await prisma.aiCapabilityConfig.deleteMany({ where: { capability: 'photo', baseUrl: '' } })
  await prisma.$disconnect()
})

const putReq = (body: unknown) =>
  new NextRequest('http://localhost/api/admin/pricing', { method: 'PUT', body: JSON.stringify(body) })

describe('积分定价', () => {
  it('PUT 视频单价 0.5 → GET 回读一致（cc 落库）', async () => {
    const res = await PUT(putReq({ videoPriceCredits: '0.5' }), { params: {} })
    expect(res.status).toBe(200)
    expect((await prisma.siteConfig.findUniqueOrThrow({ where: { id: 1 } })).videoPriceCc).toBe(50)
    const g = await (await GET(new NextRequest('http://localhost/x'), { params: {} })).json()
    expect(g.videoPriceCredits).toBe('0.50')
  })

  it('PUT 生图单价 0.08 → extra.pricePerImage 更新且保留其他高级参数', async () => {
    await prisma.aiCapabilityConfig.upsert({
      where: { capability: 'photo' },
      update: { extra: { resolution: '2k', pricePerImage: 1 } },
      create: { capability: 'photo', baseUrl: '', model: '', enabled: false, extra: { resolution: '2k', pricePerImage: 1 } },
    })
    const res = await PUT(putReq({ photoPriceCredits: '0.08' }), { params: {} })
    expect(res.status).toBe(200)
    const row = await prisma.aiCapabilityConfig.findUniqueOrThrow({ where: { capability: 'photo' } })
    expect(row.extra).toMatchObject({ resolution: '2k', pricePerImage: 0.08 })
  })

  it('三位小数 / 非数字 → 400', async () => {
    expect((await PUT(putReq({ videoPriceCredits: '0.001' }), { params: {} })).status).toBe(400)
    expect((await PUT(putReq({ photoPriceCredits: 'abc' }), { params: {} })).status).toBe(400)
  })
})
