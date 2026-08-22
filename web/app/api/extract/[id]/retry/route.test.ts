import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest'
import { NextRequest } from 'next/server'
import { prisma } from '@mixcut/db'

const requireRoleMock = vi.fn()
const enqueueMock = vi.fn()
vi.mock('@/lib/auth', async () => {
  const actual = await vi.importActual<typeof import('@/lib/auth')>('@/lib/auth')
  return { ...actual, requireRole: (...args: unknown[]) => requireRoleMock(...args) }
})
vi.mock('@mixcut/db', async () => {
  const actual = await vi.importActual<typeof import('@mixcut/db')>('@mixcut/db')
  return { ...actual, enqueueGen: (...args: unknown[]) => enqueueMock(...args) }
})

const { POST } = await import('./route')

const ids: string[] = []
afterAll(async () => {
  await prisma.transcript.deleteMany({ where: { sourceVideoId: { in: ids } } })
  await prisma.sceneCut.deleteMany({ where: { sourceVideoId: { in: ids } } })
  await prisma.sourceVideo.deleteMany({ where: { id: { in: ids } } })
  await prisma.$disconnect()
})

async function makeSource(data: { status?: string; videoFileUrl?: string | null; douyinShareUrl?: string }) {
  const s = await prisma.sourceVideo.create({
    data: {
      douyinShareUrl: data.douyinShareUrl ?? '(manual-upload)',
      videoFileUrl: data.videoFileUrl === undefined ? '/api/files/source/x.mp4' : data.videoFileUrl,
      status: data.status ?? 'FAILED',
      createdBy: 'op1',
    },
  })
  ids.push(s.id)
  return s
}

const req = () => new NextRequest('http://localhost/x', { method: 'POST' })
const ctx = (id: string) => ({ params: { id } })

beforeEach(() => {
  requireRoleMock.mockReset()
  enqueueMock.mockReset()
  requireRoleMock.mockResolvedValue({ userId: 'op1', role: 'operator' })
})

describe('POST /api/extract/[id]/retry —— 按已有产物续跑', () => {
  it('只有视频文件 → 从转写起', async () => {
    const s = await makeSource({})
    const d = await (await POST(req(), ctx(s.id))).json()
    expect(d.resumedFrom).toBe('transcribe')
    expect(enqueueMock).toHaveBeenCalledWith('transcribe', { sourceVideoId: s.id })
    const fresh = await prisma.sourceVideo.findUniqueOrThrow({ where: { id: s.id } })
    expect(fresh.status).toBe('TRANSCRIBING')
  })

  // ★ 不重复烧已经成功的步骤：ASR 是花钱的外部调用，转写已在库里就不再跑
  it('已有转写 → 跳过 ASR，从场景检测起', async () => {
    const s = await makeSource({})
    await prisma.transcript.create({ data: { sourceVideoId: s.id, fullText: 'x', sentences: [] } })
    const d = await (await POST(req(), ctx(s.id))).json()
    expect(d.resumedFrom).toBe('detect-scenes')
    expect(enqueueMock).toHaveBeenCalledWith('detect-scenes', { sourceVideoId: s.id })
  })

  it('已有分镜切点 → 只重跑框架提炼', async () => {
    const s = await makeSource({})
    await prisma.transcript.create({ data: { sourceVideoId: s.id, fullText: 'x', sentences: [] } })
    await prisma.sceneCut.create({ data: { sourceVideoId: s.id, cutPointsMs: [1000] } })
    const d = await (await POST(req(), ctx(s.id))).json()
    expect(d.resumedFrom).toBe('extract-framework')
  })

  it('链接任务且没下载成功 → 重新下载', async () => {
    const s = await makeSource({ videoFileUrl: null, douyinShareUrl: 'https://v.douyin.com/abc' })
    const d = await (await POST(req(), ctx(s.id))).json()
    expect(d.resumedFrom).toBe('download-douyin')
  })

  it('非失败态 → 400，不入队', async () => {
    const s = await makeSource({ status: 'TRANSCRIBING' })
    expect((await POST(req(), ctx(s.id))).status).toBe(400)
    expect(enqueueMock).not.toHaveBeenCalled()
  })

  it('别人的任务 → 404（与详情页同一归属口径）', async () => {
    requireRoleMock.mockResolvedValue({ userId: 'op2', role: 'operator' })
    const s = await makeSource({})
    expect((await POST(req(), ctx(s.id))).status).toBe(404)
  })
})
