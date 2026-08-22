import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest'
import { NextRequest } from 'next/server'
import { prisma } from '@mixcut/db'

const requireRoleMock = vi.fn()
vi.mock('@/lib/auth', async () => {
  const actual = await vi.importActual<typeof import('@/lib/auth')>('@/lib/auth')
  return { ...actual, requireRole: (...args: unknown[]) => requireRoleMock(...args) }
})

const { POST } = await import('./route')

const bgmIds: string[] = []
const fwIds: string[] = []
const taskIds: string[] = []

afterAll(async () => {
  await prisma.renderTask.deleteMany({ where: { generationTaskId: { in: taskIds } } })
  await prisma.generationTask.deleteMany({ where: { id: { in: taskIds } } })
  await prisma.copyFramework.deleteMany({ where: { id: { in: fwIds } } })
  await prisma.bgmLibrary.deleteMany({ where: { id: { in: bgmIds } } })
  await prisma.$disconnect()
})

async function makeBgm(name: string) {
  const b = await prisma.bgmLibrary.create({ data: { fileUrl: `/api/files/bgm/${name}.mp3`, name } })
  bgmIds.push(b.id)
  return b
}

const req = (body: unknown) =>
  new NextRequest('http://localhost/api/bgm/batch-delete', { method: 'POST', body: JSON.stringify(body) })

beforeEach(() => {
  requireRoleMock.mockReset()
  requireRoleMock.mockResolvedValue({ userId: 'op1', role: 'operator' })
})

describe('POST /api/bgm/batch-delete', () => {
  it('批量删除选中的条目', async () => {
    const a = await makeBgm('批删甲')
    const b = await makeBgm('批删乙')
    const r = await POST(req({ ids: [a.id, b.id] }), { params: {} })
    const d = await r.json()
    expect(d.deleted).toBe(2)
    expect(d.skipped).toEqual([])
    expect(await prisma.bgmLibrary.count({ where: { id: { in: [a.id, b.id] } } })).toBe(0)
  })

  // ★ 被渲染任务引用的要**跳过并报告**：不能因为一条被引用整批失败，
  // 也不能连引用的一起删（成片回放会找不到曲子的归属记录）。
  it('被渲染任务引用的跳过并报告，其余照删', async () => {
    const used = await makeBgm('被引用曲')
    const free = await makeBgm('未引用曲')
    const fw = await prisma.copyFramework.create({ data: { frameworkText: 'T' } })
    fwIds.push(fw.id)
    const task = await prisma.generationTask.create({ data: { subject: 'x', frameworkId: fw.id } })
    taskIds.push(task.id)
    await prisma.renderTask.create({ data: { generationTaskId: task.id, status: 'EXPORTED', bgmId: used.id } })

    const r = await POST(req({ ids: [used.id, free.id] }), { params: {} })
    const d = await r.json()
    expect(d.deleted).toBe(1)
    expect(d.skipped).toHaveLength(1)
    expect(d.skipped[0].reason).toContain('渲染任务引用')
    expect(await prisma.bgmLibrary.count({ where: { id: used.id } }), '被引用的不能被删').toBe(1)
    expect(await prisma.bgmLibrary.count({ where: { id: free.id } })).toBe(0)
  })

  it('已经不存在的 id 计入 deleted（幂等，与单条删除同语义）', async () => {
    const r = await POST(req({ ids: ['00000000-0000-0000-0000-00000000dead'] }), { params: {} })
    const d = await r.json()
    expect(d.deleted).toBe(1)
  })

  it('空列表 / 脏请求体 → 400', async () => {
    expect((await POST(req({ ids: [] }), { params: {} })).status).toBe(400)
    expect((await POST(req({}), { params: {} })).status).toBe(400)
  })
})
