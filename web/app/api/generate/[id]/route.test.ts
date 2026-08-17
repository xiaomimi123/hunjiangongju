import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import { NextRequest } from 'next/server'
import { prisma } from '@mixcut/db'

const requireRoleMock = vi.fn()
vi.mock('@/lib/auth', async () => {
  const actual = await vi.importActual<typeof import('@/lib/auth')>('@/lib/auth')
  return { ...actual, requireRole: (...args: unknown[]) => requireRoleMock(...args) }
})

const { GET } = await import('./route')

const frameworkIds: string[] = []
const taskIds: string[] = []

afterAll(async () => {
  await prisma.generationTask.deleteMany({ where: { id: { in: taskIds } } })
  await prisma.copyFramework.deleteMany({ where: { id: { in: frameworkIds } } })
  await prisma.$disconnect()
})

async function makeFramework() {
  const fw = await prisma.copyFramework.create({
    data: { frameworkText: '测试框架文本' },
  })
  frameworkIds.push(fw.id)
  return fw
}

async function makeTask(frameworkId: string, variables: unknown, createdBy: string | null = 'stu1') {
  const task = await prisma.generationTask.create({
    data: { subject: '测试选题', frameworkId, variables: (variables ?? undefined) as never, createdBy },
  })
  taskIds.push(task.id)
  return task
}

function req(id: string) {
  return new NextRequest(`http://localhost/api/generate/${id}`)
}

beforeAll(() => {
  requireRoleMock.mockResolvedValue({ userId: 'stu1', role: 'student' })
})

describe('GET /api/generate/[id]', () => {
  it('学员：variables 含运营字段(voiceId/assetSource/__bgmId) 时，只下发 books 的 title/author 投影，不下发整个 variables', async () => {
    const fw = await makeFramework()
    const task = await makeTask(fw.id, {
      voiceId: 'secret-voice-id',
      assetSource: 'library',
      assetFolder: '旅行',
      scriptMode: 'manual',
      __bgmId: 'bgm-1',
      books: [
        { title: '被讨厌的勇气', author: '岸见一郎', points: ['课题分离'] },
        { title: '活着', author: '余华' },
      ],
    })
    requireRoleMock.mockResolvedValueOnce({ userId: 'stu1', role: 'student' })
    const res = await GET(req(task.id), { params: { id: task.id } })
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.variables).toBeUndefined()
    expect(json.books).toEqual([
      { title: '被讨厌的勇气', author: '岸见一郎' },
      { title: '活着', author: '余华' },
    ])
  })

  it('学员：variables.books 为空/缺失时，不下发 books 字段', async () => {
    const fw = await makeFramework()
    const task = await makeTask(fw.id, { voiceId: 'secret' })
    requireRoleMock.mockResolvedValueOnce({ userId: 'stu1', role: 'student' })
    const res = await GET(req(task.id), { params: { id: task.id } })
    const json = await res.json()
    expect(json.books).toBeUndefined()
    expect(json.variables).toBeUndefined()
  })

  it('运营：仍下发完整 variables（供编辑页读取 __bgmId 等字段），零回归', async () => {
    const fw = await makeFramework()
    const task = await makeTask(fw.id, { __bgmId: 'bgm-1', voiceId: 'v1', books: [{ title: 'A', author: 'B' }] }, 'op1')
    requireRoleMock.mockResolvedValueOnce({ userId: 'op1', role: 'operator' })
    const res = await GET(req(task.id), { params: { id: task.id } })
    const json = await res.json()
    expect(json.variables).toEqual({ __bgmId: 'bgm-1', voiceId: 'v1', books: [{ title: 'A', author: 'B' }] })
  })

  it('他人任务 → 404（既有 ownership 校验不回归）', async () => {
    const fw = await makeFramework()
    const task = await makeTask(fw.id, null, 'someone-else')
    requireRoleMock.mockResolvedValueOnce({ userId: 'stu1', role: 'student' })
    const res = await GET(req(task.id), { params: { id: task.id } })
    expect(res.status).toBe(404)
  })
})
