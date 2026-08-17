// Task 5：拆掉「框架 overlayTemplate.books 顶替学员选题」的根因规则。
// 用 DB 集成测试驱动 generateScript() 全流程，捕获实际发给 LLM 的 prompt 来断言：
// - 框架带 books、variables 无 books（mode=subject）→ 不再被顶替进 books 模式；prompt 不含框架书名，含 subject。
// - 运营手填 books 时既有行为不变：仍用手填书目，不受框架书目干扰（零回归关键路径）。
import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest'

const mockLlmComplete = vi.fn()
const mockIsMockMode = vi.fn()
const mockGetCapabilityConfig = vi.fn()
const mockEnqueueGen = vi.fn()

vi.mock('@mixcut/db', async () => {
  const actual = await vi.importActual<typeof import('@mixcut/db')>('@mixcut/db')
  return {
    ...actual,
    llmComplete: (...args: unknown[]) => mockLlmComplete(...args),
    isMockMode: (...args: unknown[]) => mockIsMockMode(...args),
    getCapabilityConfig: (...args: unknown[]) => mockGetCapabilityConfig(...args),
    enqueueGen: (...args: unknown[]) => mockEnqueueGen(...args),
  }
})

import { prisma } from '@mixcut/db'
import { generateScript } from './generateScript'

const frameworkIds: string[] = []
const taskIds: string[] = []

afterAll(async () => {
  await prisma.generatedSegment.deleteMany({ where: { generationTaskId: { in: taskIds } } })
  await prisma.generationTask.deleteMany({ where: { id: { in: taskIds } } })
  await prisma.copyFramework.deleteMany({ where: { id: { in: frameworkIds } } })
})

async function makeFramework(overlayTemplate: unknown) {
  const fw = await prisma.copyFramework.create({
    data: {
      frameworkText: '开头钩子+逐段展开，语气亲切',
      overlayTemplate: overlayTemplate as never,
      suggestedSegmentCount: 2,
      maxLines: 10,
      maxTotalChars: 200,
    },
  })
  frameworkIds.push(fw.id)
  return fw
}

async function makeTask(subject: string, frameworkId: string, variables?: unknown) {
  const task = await prisma.generationTask.create({
    data: { subject, frameworkId, variables: (variables ?? undefined) as never },
  })
  taskIds.push(task.id)
  return task
}

beforeEach(() => {
  mockLlmComplete.mockReset()
  mockIsMockMode.mockReset()
  mockGetCapabilityConfig.mockReset()
  mockEnqueueGen.mockReset()
  mockGetCapabilityConfig.mockResolvedValue({ capability: 'llm', baseUrl: '', apiKey: '', model: '', enabled: false, extra: {} })
  // 让 translateLine 走 mock 短路，不额外发起 llmComplete 调用，这样 mockLlmComplete 的唯一一次
  // 调用就是文案生成本身，方便直接断言其 prompt。
  mockIsMockMode.mockReturnValue(true)
  mockLlmComplete.mockResolvedValue('第一句测试文案。\n第二句测试文案。')
})

describe('generateScript：框架 overlayTemplate.books 不再顶替学员选题（根因修复）', () => {
  it('框架带 books、variables 无 books（mode=subject）→ prompt 不含框架书名，含 subject', async () => {
    const fw = await makeFramework({
      books: [
        { title: '框架原书甲', author: '原作者甲' },
        { title: '框架原书乙', author: '原作者乙' },
      ],
    })
    const task = await makeTask('学员自己的选题：如何走出低谷期', fw.id)

    await generateScript(task.id)

    expect(mockLlmComplete).toHaveBeenCalledTimes(1)
    const prompt = mockLlmComplete.mock.calls[0][0].prompt as string
    expect(prompt).not.toContain('框架原书甲')
    expect(prompt).not.toContain('框架原书乙')
    expect(prompt).toContain('学员自己的选题：如何走出低谷期')

    const segments = await prisma.generatedSegment.findMany({ where: { generationTaskId: task.id } })
    expect(segments.every((s) => !s.bookTitle)).toBe(true)
  })

  it('运营手填 books：既有行为不变——仍用手填书目，不受框架书目干扰', async () => {
    const fw = await makeFramework({
      books: [{ title: '框架原书甲', author: '原作者甲' }],
    })
    const task = await makeTask('不重要的选题字段', fw.id, {
      books: [{ title: '运营手填书', author: '运营作者' }],
    })

    await generateScript(task.id)

    expect(mockLlmComplete).toHaveBeenCalledTimes(1)
    const prompt = mockLlmComplete.mock.calls[0][0].prompt as string
    expect(prompt).toContain('运营手填书')
    expect(prompt).not.toContain('框架原书甲')

    const segments = await prisma.generatedSegment.findMany({ where: { generationTaskId: task.id }, orderBy: { seqNo: 'asc' } })
    expect(segments.every((s) => s.bookTitle === '运营手填书')).toBe(true)
  })
})
