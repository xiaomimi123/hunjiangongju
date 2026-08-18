// 书名头改由 LLM 的书序号标记决定后，用 DB 集成测试驱动 generateScript() 全流程验证三件事：
// 标记生效、无标记时回退均分、标记在预算校验前被剥离。
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

// 快闪模板 + 可调预算：预算用于第 3 条「标记必须在预算校验前剥离」的鉴别性构造。
async function makeFramework(maxTotalChars = 200) {
  const fw = await prisma.copyFramework.create({
    data: {
      frameworkText: '开头钩子+逐段展开，语气亲切',
      overlayTemplate: { __templateParams: { mode: 'flash', open: { titleText: '今天分享的是' } } } as never,
      suggestedSegmentCount: 6,
      maxLines: 10,
      maxTotalChars,
    },
  })
  frameworkIds.push(fw.id)
  return fw
}

const BOOKS = [{ title: '甲书', author: '甲作者' }, { title: '乙书', author: '乙作者' }, { title: '丙书' }]

async function makeTask(frameworkId: string) {
  const task = await prisma.generationTask.create({
    data: { subject: '走出低谷期', frameworkId, variables: { books: BOOKS } as never },
  })
  taskIds.push(task.id)
  return task
}

async function bookTitles(taskId: string) {
  const segs = await prisma.generatedSegment.findMany({ where: { generationTaskId: taskId }, orderBy: { seqNo: 'asc' } })
  return segs.map((s) => s.bookTitle ?? null)
}

beforeEach(() => {
  mockLlmComplete.mockReset()
  mockIsMockMode.mockReset()
  mockGetCapabilityConfig.mockReset()
  mockEnqueueGen.mockReset()
  mockGetCapabilityConfig.mockResolvedValue({ capability: 'llm', baseUrl: '', apiKey: '', model: '', enabled: false, extra: {} })
  // translateLine 走 mock 短路，保证 mockLlmComplete 的调用只来自文案生成本身
  mockIsMockMode.mockReturnValue(true)
})

describe('generateScript：《书名》头跟随书序号标记', () => {
  it('LLM 返回带标记 → 书名头按标记分配，而非位置均分', async () => {
    const fw = await makeFramework()
    const task = await makeTask(fw.id)
    // 标记分配 → [null,甲,甲,甲,乙,丙]
    // 位置均分 allocateBookIndexes(6,3)=[0,0,1,1,2,2] → [甲,甲,乙,乙,丙,丙]
    // 两者在 4 个位置上不同，测试有鉴别力
    mockLlmComplete.mockResolvedValue('0|今天分享的是三本书\n1|甲书一句\n1|甲书二句\n1|甲书三句\n2|乙书一句\n3|丙书一句')

    await generateScript(task.id)

    expect(await bookTitles(task.id)).toEqual([null, '甲书', '甲书', '甲书', '乙书', '丙书'])
  })

  it('落库文案不带书序号前缀', async () => {
    const fw = await makeFramework()
    const task = await makeTask(fw.id)
    mockLlmComplete.mockResolvedValue('0|今天分享的是三本书\n1|甲书一句\n2|乙书一句')

    await generateScript(task.id)

    const segs = await prisma.generatedSegment.findMany({ where: { generationTaskId: task.id }, orderBy: { seqNo: 'asc' } })
    expect(segs.map((s) => s.scriptText)).toEqual(['今天分享的是三本书', '甲书一句', '乙书一句'])
  })

  it('LLM 不按格式返回 → 回退位置均分，任务不失败', async () => {
    const fw = await makeFramework()
    const task = await makeTask(fw.id)
    mockLlmComplete.mockResolvedValue('甲书一句\n乙书一句\n丙书一句')

    await generateScript(task.id)

    // allocateBookIndexes(3,3) = [0,1,2]
    expect(await bookTitles(task.id)).toEqual(['甲书', '乙书', '丙书'])
  })

  it('书序号标记在预算校验前被剥离（不挤占字数预算）', async () => {
    // 3 行文案各 10 字 = 30 字；带 '1|' 前缀后 = 36 字。预算设 32：
    // 剥离后 30 ≤ 32 → 一次通过、3 段落库；未剥离则 36 > 32 → 重试 3 次后裁剪，只剩 2 段。
    const fw = await makeFramework(32)
    const task = await makeTask(fw.id)
    mockLlmComplete.mockResolvedValue('1|甲甲甲甲甲甲甲甲甲甲\n2|乙乙乙乙乙乙乙乙乙乙\n3|丙丙丙丙丙丙丙丙丙丙')

    await generateScript(task.id)

    expect(mockLlmComplete).toHaveBeenCalledTimes(1) // 未触发超预算重试
    const segs = await prisma.generatedSegment.findMany({ where: { generationTaskId: task.id } })
    expect(segs.length).toBe(3)
  })

  it('部分行漏打标记（混合标记）→ 全部标记前缀仍被剥离，书名头回退位置均分', async () => {
    // parseBookMarkedLines 全有或全无：6 行里第 3 行漏打标记 → 整体判定失败，
    // 书名头归属回退到 allocateBookIndexes(6,3)=[0,0,1,1,2,2] → [甲,甲,乙,乙,丙,丙]；
    // 但已经打了标记的另外 5 行不能带着「0|」「1|」「2|」「3|」前缀落库。
    const fw = await makeFramework()
    const task = await makeTask(fw.id)
    mockLlmComplete.mockResolvedValue(
      '0|开场白文案\n1|甲书一句\n甲书二句缺标记\n2|乙书一句\n2|乙书二句\n3|丙书一句',
    )

    await generateScript(task.id)

    const segs = await prisma.generatedSegment.findMany({ where: { generationTaskId: task.id }, orderBy: { seqNo: 'asc' } })
    expect(segs.map((s) => s.scriptText)).toEqual([
      '开场白文案',
      '甲书一句',
      '甲书二句缺标记',
      '乙书一句',
      '乙书二句',
      '丙书一句',
    ])
    expect(await bookTitles(task.id)).toEqual(['甲书', '甲书', '乙书', '乙书', '丙书', '丙书'])
  })

  it('imitate 模式：LLM 返回带「数字|」形状文本 → 原样保留，不误剥（非我们要求过标记的路径）', async () => {
    const fw = await makeFramework()
    const task = await prisma.generationTask.create({
      data: {
        subject: '走出低谷期',
        frameworkId: fw.id,
        variables: { books: BOOKS, scriptMode: 'imitate', customScript: '参考文案示例。' } as never,
      },
    })
    taskIds.push(task.id)
    mockLlmComplete.mockResolvedValue('1|甲书一句\n2|乙书一句')

    await generateScript(task.id)

    const segs = await prisma.generatedSegment.findMany({ where: { generationTaskId: task.id }, orderBy: { seqNo: 'asc' } })
    expect(segs.map((s) => s.scriptText)).toEqual(['1|甲书一句', '2|乙书一句'])
  })
})

describe('generateScript：开场白提示词', () => {
  it('flash 模板 → prompt 含模板开场标题与开场白要求', async () => {
    const fw = await makeFramework()
    const task = await makeTask(fw.id)
    mockLlmComplete.mockResolvedValue('0|开场白\n1|甲书一句')

    await generateScript(task.id)

    const prompt = mockLlmComplete.mock.calls[0][0].prompt as string
    expect(prompt).toContain('今天分享的是')
    expect(prompt).toContain('开场白')
    expect(prompt).not.toContain('开篇第一句直击情绪')
  })

  it('classic 模板（第 0 段照常出字幕）→ 不加开场白要求，风格准则维持原文', async () => {
    const fw = await prisma.copyFramework.create({
      data: {
        frameworkText: '开头钩子+逐段展开，语气亲切',
        overlayTemplate: { __templateParams: { mode: 'classic' } } as never,
        suggestedSegmentCount: 6, maxLines: 10, maxTotalChars: 200,
      },
    })
    frameworkIds.push(fw.id)
    const task = await makeTask(fw.id)
    mockLlmComplete.mockResolvedValue('1|甲书一句\n2|乙书一句')

    await generateScript(task.id)

    const prompt = mockLlmComplete.mock.calls[0][0].prompt as string
    expect(prompt).toContain('开篇第一句直击情绪')
    expect(prompt).not.toContain('开场白')
  })
})
