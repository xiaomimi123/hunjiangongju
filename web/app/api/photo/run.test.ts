// 实拍生图路由测试：参数校验、积分乐观闸、operator 免扣、能力未开启拒绝、
// 入队失败现场退分、列表/详情的本人边界与 errorMsg 收口。
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach, afterAll } from 'vitest'
import { NextRequest } from 'next/server'
import { prisma } from '@mixcut/db'
import { HttpError } from '@/lib/auth'

const requireRoleMock = vi.fn()
vi.mock('@/lib/auth', async () => {
  const actual = await vi.importActual<typeof import('@/lib/auth')>('@/lib/auth')
  return { ...actual, requireRole: (...args: unknown[]) => requireRoleMock(...args) }
})

const enqueueMock = vi.fn()
const capConfigMock = vi.fn()
vi.mock('@mixcut/db', async () => {
  const actual = await vi.importActual<typeof import('@mixcut/db')>('@mixcut/db')
  return {
    ...actual,
    enqueuePhotoGenRun: (...args: unknown[]) => enqueueMock(...args),
    getCapabilityConfig: (...args: unknown[]) => capConfigMock(...args),
  }
})

let runPOST: typeof import('./run/route').POST
let runsGET: typeof import('./runs/route').GET
let detailGET: typeof import('./runs/[id]/route').GET

beforeAll(async () => {
  ;({ POST: runPOST } = await import('./run/route'))
  ;({ GET: runsGET } = await import('./runs/route'))
  ;({ GET: detailGET } = await import('./runs/[id]/route'))
})

const userIds: string[] = []
const runIds: string[] = []

beforeEach(() => {
  requireRoleMock.mockReset()
  enqueueMock.mockReset()
  capConfigMock.mockReset()
  capConfigMock.mockResolvedValue({ capability: 'photo', baseUrl: 'https://x', apiKey: 'k', model: 'm', enabled: true, extra: {} })
})

afterEach(async () => {
  if (runIds.length) await prisma.photoGenRun.deleteMany({ where: { id: { in: runIds.splice(0) } } })
})
afterAll(async () => {
  if (userIds.length) await prisma.creditLog.deleteMany({ where: { userId: { in: userIds } } })
  if (userIds.length) await prisma.user.deleteMany({ where: { id: { in: userIds } } })
  await prisma.$disconnect()
})

let seq = 0
async function makeStudent(credits = 1000) {
  seq += 1
  const u = await prisma.user.create({
    data: { email: `photo-rt-${process.pid}-${seq}@test.local`, passwordHash: 'x', role: 'student', credits },
  })
  userIds.push(u.id)
  return u
}

function jsonReq(body: unknown) {
  return new NextRequest('http://localhost/api/photo/run', {
    method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' },
  })
}
const VALID = { mode: 'cover', shotMode: 'lap_front', count: 2, inputImage: 'photo-uploads/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.jpg' }

async function trackRunOf(res: Response) {
  if (res.status === 200) runIds.push((await res.clone().json()).id)
  return res
}

describe('POST /api/photo/run', () => {
  it('未登录 → 401', async () => {
    requireRoleMock.mockRejectedValueOnce(new HttpError(401, '未登录'))
    const res = await runPOST(jsonReq(VALID), { params: {} })
    expect(res.status).toBe(401)
  })

  it('mode 非法 → 400', async () => {
    const u = await makeStudent()
    requireRoleMock.mockResolvedValue({ userId: u.id, role: 'student' })
    const res = await runPOST(jsonReq({ ...VALID, mode: 'x' }), { params: {} })
    expect(res.status).toBe(400)
  })

  it('inputImage 路径穿越 → 400，不扣分', async () => {
    const u = await makeStudent(10)
    requireRoleMock.mockResolvedValue({ userId: u.id, role: 'student' })
    const res = await runPOST(jsonReq({ ...VALID, inputImage: '../../etc/passwd' }), { params: {} })
    expect(res.status).toBe(400)
    expect((await prisma.user.findUniqueOrThrow({ where: { id: u.id } })).credits).toBe(10)
  })

  it('能力未开启 → 503', async () => {
    const u = await makeStudent()
    requireRoleMock.mockResolvedValue({ userId: u.id, role: 'student' })
    capConfigMock.mockResolvedValue({ capability: 'photo', baseUrl: '', apiKey: '', model: '', enabled: false, extra: {} })
    const res = await runPOST(jsonReq(VALID), { params: {} })
    expect(res.status).toBe(503)
  })

  it('积分充足 → 扣 count×单价（cc）、建 run、入队', async () => {
    const u = await makeStudent(1000)
    requireRoleMock.mockResolvedValue({ userId: u.id, role: 'student' })
    const res = await trackRunOf(await runPOST(jsonReq(VALID), { params: {} }))
    expect(res.status).toBe(200)
    const { id } = await res.json()
    const run = await prisma.photoGenRun.findUniqueOrThrow({ where: { id } })
    expect(run.creditsCost).toBe(200) // 2 张 × 100cc(1 积分)/张
    expect(run.mode).toBe('cover')
    expect(run.shotMode).toBe('lap_front')
    expect(enqueueMock).toHaveBeenCalledWith(id)
    expect((await prisma.user.findUniqueOrThrow({ where: { id: u.id } })).credits).toBe(800)
    // 扣费入流水
    const logs = await prisma.creditLog.findMany({ where: { userId: u.id } })
    expect(logs).toHaveLength(1)
    expect(logs[0].delta).toBe(-200)
    expect(logs[0].reason).toContain('实拍生图')
  })

  it('单价从 extra.pricePerImage 生效（积分 → cc）', async () => {
    const u = await makeStudent(1000)
    requireRoleMock.mockResolvedValue({ userId: u.id, role: 'student' })
    capConfigMock.mockResolvedValue({ capability: 'photo', baseUrl: 'x', apiKey: 'k', model: 'm', enabled: true, extra: { pricePerImage: 3 } })
    const res = await trackRunOf(await runPOST(jsonReq({ ...VALID, count: 2 }), { params: {} }))
    expect(res.status).toBe(200)
    expect((await prisma.user.findUniqueOrThrow({ where: { id: u.id } })).credits).toBe(400) // 1000 - 2×300cc
  })

  it('小数单价 0.08/张：1 张扣 8cc、4 张扣 32cc（精确计费）', async () => {
    const u = await makeStudent(1000)
    requireRoleMock.mockResolvedValue({ userId: u.id, role: 'student' })
    capConfigMock.mockResolvedValue({ capability: 'photo', baseUrl: 'x', apiKey: 'k', model: 'm', enabled: true, extra: { pricePerImage: 0.08 } })
    await trackRunOf(await runPOST(jsonReq({ ...VALID, count: 1 }), { params: {} }))
    expect((await prisma.user.findUniqueOrThrow({ where: { id: u.id } })).credits).toBe(992)
    await trackRunOf(await runPOST(jsonReq({ ...VALID, count: 4 }), { params: {} }))
    expect((await prisma.user.findUniqueOrThrow({ where: { id: u.id } })).credits).toBe(960)
  })

  it('积分不足 → 403 NO_CREDITS，不建 run 不入队', async () => {
    const u = await makeStudent(100)
    requireRoleMock.mockResolvedValue({ userId: u.id, role: 'student' })
    const res = await runPOST(jsonReq(VALID), { params: {} })
    expect(res.status).toBe(403)
    expect((await res.json()).code).toBe('NO_CREDITS')
    expect(await prisma.photoGenRun.count({ where: { userId: u.id } })).toBe(0)
    expect(enqueueMock).not.toHaveBeenCalled()
  })

  it('operator 免扣分，creditsCost 记 0', async () => {
    const u = await makeStudent(5)
    requireRoleMock.mockResolvedValue({ userId: u.id, role: 'operator' })
    const res = await trackRunOf(await runPOST(jsonReq(VALID), { params: {} }))
    const { id } = await res.json()
    expect((await prisma.photoGenRun.findUniqueOrThrow({ where: { id } })).creditsCost).toBe(0)
    expect((await prisma.user.findUniqueOrThrow({ where: { id: u.id } })).credits).toBe(5)
  })

  it('入队失败 → 非 200、run 落 FAILED、积分退回', async () => {
    const u = await makeStudent(1000)
    requireRoleMock.mockResolvedValue({ userId: u.id, role: 'student' })
    enqueueMock.mockRejectedValueOnce(new Error('redis 挂了'))
    const res = await runPOST(jsonReq(VALID), { params: {} })
    expect(res.status).not.toBe(200)
    const run = await prisma.photoGenRun.findFirstOrThrow({ where: { userId: u.id } })
    runIds.push(run.id)
    expect(run.status).toBe('FAILED')
    expect(run.refunded).toBe(true)
    expect((await prisma.user.findUniqueOrThrow({ where: { id: u.id } })).credits).toBe(1000)
  })
})

describe('生图记录：列表与详情', () => {
  it('列表只返回本人的', async () => {
    const a = await makeStudent(); const b = await makeStudent()
    const mine = await prisma.photoGenRun.create({ data: { userId: a.id, mode: 'cover', count: 1, inputImage: 'photo-uploads/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.jpg' } })
    const theirs = await prisma.photoGenRun.create({ data: { userId: b.id, mode: 'cover', count: 1, inputImage: 'photo-uploads/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.jpg' } })
    runIds.push(mine.id, theirs.id)
    requireRoleMock.mockResolvedValue({ userId: a.id, role: 'student' })
    const res = await runsGET(new NextRequest('http://localhost/api/photo/runs'), { params: {} })
    const { runs } = await res.json()
    const ids = runs.map((r: { id: string }) => r.id)
    expect(ids).toContain(mine.id)
    expect(ids).not.toContain(theirs.id)
  })

  it('详情：越权 → 404；学员看到的 errorMsg 收口', async () => {
    const a = await makeStudent(); const b = await makeStudent()
    const run = await prisma.photoGenRun.create({
      data: {
        userId: a.id, mode: 'inner', count: 1, status: 'FAILED',
        errorMsg: '生图提交失败 500: {"internal":"/root/dongfangwenlan/secret"}',
        inputImage: 'photo-uploads/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.jpg',
      },
    })
    runIds.push(run.id)
    requireRoleMock.mockResolvedValue({ userId: b.id, role: 'student' })
    const denied = await detailGET(new NextRequest(`http://localhost/api/photo/runs/${run.id}`), { params: { id: run.id } })
    expect(denied.status).toBe(404)

    requireRoleMock.mockResolvedValue({ userId: a.id, role: 'student' })
    const ok = await detailGET(new NextRequest(`http://localhost/api/photo/runs/${run.id}`), { params: { id: run.id } })
    const body = await ok.json()
    expect(body.errorMsg).not.toContain('/root/')
    expect(body.userId).toBeUndefined()

    requireRoleMock.mockResolvedValue({ userId: 'op', role: 'operator' })
    const opRes = await detailGET(new NextRequest(`http://localhost/api/photo/runs/${run.id}`), { params: { id: run.id } })
    expect((await opRes.json()).errorMsg).toContain('生图提交失败')
  })
})
