// processPhotoRun 行为测试：假 deps + 真数据库。覆盖：封面链路（双图输入+4:5）、
// 内页链路（先分类再生成+3:4）、成功转存落库、全失败退分、部分成功按张退分、
// 幂等（重复投递不重复消费）、原图路径不合法拒绝。

import { describe, it, expect, vi, afterAll } from 'vitest'
import { promises as fs } from 'fs'
import path from 'path'

const dataDir = vi.hoisted(() => {
  const dir = `${process.env.TMPDIR ?? '/tmp'}/mixcut-photo-run-${process.pid}-${Date.now()}`
  process.env.DATA_DIR = dir
  process.env.ASSET_URL_SECRET = 'test-secret'
  process.env.PUBLIC_BASE_URL = 'http://test.local'
  return dir
})

import { prisma } from '@mixcut/db'
import { processPhotoRun, type PhotoRunDeps } from './run'

const userIds: string[] = []
const runIds: string[] = []

afterAll(async () => {
  await prisma.photoGenRun.deleteMany({ where: { id: { in: runIds } } })
  await prisma.creditLog.deleteMany({ where: { userId: { in: userIds } } })
  await prisma.user.deleteMany({ where: { id: { in: userIds } } })
  await fs.rm(dataDir, { recursive: true, force: true })
  await prisma.$disconnect()
})

let seq = 0
async function makeUser(credits = 30) {
  seq += 1
  const u = await prisma.user.create({
    data: { email: `photo-run-${process.pid}-${seq}@test.local`, passwordHash: 'x', role: 'student', credits },
  })
  userIds.push(u.id)
  return u
}

const INPUT_REL = 'photo-uploads/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.jpg'
async function ensureInput() {
  await fs.mkdir(path.join(dataDir, 'photo-uploads'), { recursive: true })
  await fs.writeFile(path.join(dataDir, INPUT_REL), Buffer.from('fake-photo-bytes'))
}

async function makeRun(userId: string, opts: Partial<{ mode: string; shotMode: string | null; style: string | null; count: number; creditsCost: number; inputImage: string }> = {}) {
  const r = await prisma.photoGenRun.create({
    data: {
      userId,
      mode: opts.mode ?? 'cover',
      shotMode: opts.shotMode ?? 'lap_front',
      style: opts.style ?? null,
      count: opts.count ?? 1,
      inputImage: opts.inputImage ?? INPUT_REL,
      creditsCost: opts.creditsCost ?? 1,
    },
  })
  runIds.push(r.id)
  return r
}

function fakeDeps(overrides: Partial<PhotoRunDeps> = {}): PhotoRunDeps {
  return {
    generate: vi.fn(async () => ['https://remote/img.png']),
    classify: vi.fn(async () => ({ title: '测试标题', pageSide: 'right' as const, titleBand: 'middle' as const })),
    download: vi.fn(async () => Buffer.from('generated-bytes')),
    ...overrides,
  }
}

describe('processPhotoRun', () => {
  it('封面链路：双图输入（原图+参考图）、4:5、成品转存本地、SUCCEEDED', async () => {
    await ensureInput()
    const user = await makeUser()
    const run = await makeRun(user.id, { mode: 'cover', shotMode: 'lap_front', count: 1, creditsCost: 1 })
    const generate = vi.fn(async (opts: { prompt: string; images: string[]; size: string }) => {
      expect(opts.size).toBe('4:5')
      expect(opts.images).toHaveLength(2) // 原图 + 姿态参考图
      expect(opts.images[0]).toMatch(/^data:image\/jpeg;base64,/)
      expect(opts.prompt).toContain('拍法为腿上正面持书')
      return ['https://remote/1.png']
    })
    await processPhotoRun(run.id, fakeDeps({ generate }))

    const found = await prisma.photoGenRun.findUniqueOrThrow({ where: { id: run.id } })
    expect(found.status).toBe('SUCCEEDED')
    expect(found.outputImages).toEqual([{ url: `photo-gen/${run.id}/1.png` }])
    await expect(fs.readFile(path.join(dataDir, `photo-gen/${run.id}/1.png`))).resolves.toEqual(Buffer.from('generated-bytes'))
  })

  it('内页链路：先 classify 后生成，标题与分类进了提示词，3:4', async () => {
    await ensureInput()
    const user = await makeUser()
    const run = await makeRun(user.id, { mode: 'inner', shotMode: null, style: 'S01', count: 1 })
    const classify = vi.fn(async () => ({ title: '他/她是在嫌弃我吗', pageSide: 'right' as const, titleBand: 'lower' as const }))
    const generate = vi.fn(async (opts: { prompt: string; images: string[]; size: string }) => {
      expect(opts.size).toBe('3:4')
      expect(opts.images).toHaveLength(1)
      expect(opts.prompt).toContain('「他/她是在嫌弃我吗」')
      expect(opts.prompt).toContain('原标题位于纸页下部')
      return ['https://remote/1.png']
    })
    await processPhotoRun(run.id, fakeDeps({ classify, generate }))
    expect(classify).toHaveBeenCalledTimes(1)
    // 传给 vision 的是签名公网 URL
    expect(classify.mock.calls[0][0]).toContain('http://test.local/api/files/photo-uploads/')
    const found = await prisma.photoGenRun.findUniqueOrThrow({ where: { id: run.id } })
    expect(found.status).toBe('SUCCEEDED')
  })

  it('全部生成失败 → FAILED + 全额退分；重复处理不重复退', async () => {
    await ensureInput()
    const user = await makeUser(10)
    const run = await makeRun(user.id, { count: 2, creditsCost: 2 })
    const deps = fakeDeps({ generate: vi.fn(async () => { throw new Error('上游挂了') }) })
    await processPhotoRun(run.id, deps)

    const found = await prisma.photoGenRun.findUniqueOrThrow({ where: { id: run.id } })
    expect(found.status).toBe('FAILED')
    expect(found.refunded).toBe(true)
    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).credits).toBe(12)

    await processPhotoRun(run.id, deps) // 重复投递
    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).credits).toBe(12)
    // 退分流水恰好一条（幂等）
    const logs = await prisma.creditLog.findMany({ where: { userId: user.id } })
    expect(logs).toHaveLength(1)
    expect(logs[0].delta).toBe(2)
    expect(logs[0].reason).toContain('实拍生图退回')
  })

  it('部分成功（3 张成 2 张）→ SUCCEEDED + 按张退分 + errorMsg 注明', async () => {
    await ensureInput()
    const user = await makeUser(10)
    const run = await makeRun(user.id, { count: 3, creditsCost: 3 })
    let call = 0
    const generate = vi.fn(async () => {
      call += 1
      if (call === 2) throw new Error('这张挂了')
      return [`https://remote/${call}.png`]
    })
    await processPhotoRun(run.id, fakeDeps({ generate }))

    const found = await prisma.photoGenRun.findUniqueOrThrow({ where: { id: run.id } })
    expect(found.status).toBe('SUCCEEDED')
    expect((found.outputImages as unknown[]).length).toBe(2)
    expect(found.creditsCost).toBe(2)
    expect(found.errorMsg).toContain('1 张生成失败')
    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).credits).toBe(11)
    const logs = await prisma.creditLog.findMany({ where: { userId: user.id } })
    expect(logs).toHaveLength(1)
    expect(logs[0].delta).toBe(1)
    expect(logs[0].reason).toContain('1 张未成')
  })

  it('小数单价的部分成功：0.5/张 4 张（总价 2）成 1 张 → 保留 ceil(2×1/4)=1、退 1', async () => {
    await ensureInput()
    const user = await makeUser(10)
    const run = await makeRun(user.id, { count: 4, creditsCost: 2 })
    let call = 0
    const generate = vi.fn(async () => {
      call += 1
      if (call > 1) throw new Error('挂了')
      return ['https://remote/1.png']
    })
    await processPhotoRun(run.id, fakeDeps({ generate }))
    const found = await prisma.photoGenRun.findUniqueOrThrow({ where: { id: run.id } })
    expect(found.status).toBe('SUCCEEDED')
    expect(found.creditsCost).toBe(1)
    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).credits).toBe(11)
  })

  it('原图路径不合法（越权写库）→ FAILED，不读任意路径', async () => {
    const user = await makeUser(10)
    const run = await makeRun(user.id, { inputImage: '../../etc/passwd', creditsCost: 1 })
    const generate = vi.fn()
    await processPhotoRun(run.id, fakeDeps({ generate }))
    const found = await prisma.photoGenRun.findUniqueOrThrow({ where: { id: run.id } })
    expect(found.status).toBe('FAILED')
    expect(generate).not.toHaveBeenCalled()
    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).credits).toBe(11)
  })

  it('已是终态的 run 再投递 → 不消费、不改状态', async () => {
    await ensureInput()
    const user = await makeUser()
    const run = await makeRun(user.id)
    await prisma.photoGenRun.update({ where: { id: run.id }, data: { status: 'SUCCEEDED' } })
    const generate = vi.fn()
    await processPhotoRun(run.id, fakeDeps({ generate }))
    expect(generate).not.toHaveBeenCalled()
  })
})
