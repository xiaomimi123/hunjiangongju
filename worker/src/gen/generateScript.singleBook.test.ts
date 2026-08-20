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
import { buildSingleBookPrompt, generateScript } from './generateScript'

const framework = { frameworkText: '框架示例：开头钩子+逐段展开', segCount: 7, maxLines: 21, maxTotalChars: 220 }
const book = { title: '被讨厌的勇气', author: '岸见一郎、古贺史健', points: '课题分离' }

describe('buildSingleBookPrompt', () => {
  it('含书名、作者、要点', () => {
    const p = buildSingleBookPrompt({ book, framework })
    expect(p).toContain('被讨厌的勇气')
    expect(p).toContain('岸见一郎、古贺史健')
    expect(p).toContain('课题分离')
  })

  it('硬性约束：只讲这一本，不得提及其他书籍', () => {
    const p = buildSingleBookPrompt({ book, framework })
    expect(p).toContain('只讲')
    expect(p).toContain('不得提及')
  })

  it('传 openTitleText 时要求首段以「今天分享的是《书名》」开场', () => {
    const p = buildSingleBookPrompt({ book, framework, openTitleText: '今天分享的是' })
    expect(p).toContain('今天分享的是《被讨厌的勇气》')
    expect(p).toContain('开场白')
    expect(p).toContain('开场白之后的第一句直击情绪')
    expect(p).not.toContain('开篇第一句直击情绪')
  })

  it('不传 openTitleText 时风格准则用原文首条', () => {
    const p = buildSingleBookPrompt({ book, framework })
    expect(p).toContain('开篇第一句直击情绪')
    expect(p).not.toContain('开场白')
  })

  it('不含书序号格式要求（单本无需标记）', () => {
    for (const p of [
      buildSingleBookPrompt({ book, framework }),
      buildSingleBookPrompt({ book, framework, openTitleText: '今天分享的是' }),
    ]) {
      expect(p).not.toContain('书序号')
    }
  })

  it('无作者/无要点时不输出空字段', () => {
    const p = buildSingleBookPrompt({ book: { title: '某书' }, framework })
    expect(p).toContain('某书')
    expect(p).not.toContain('作者：')
    expect(p).not.toContain('要点：')
  })

  it('带 angle 时进入提示词', () => {
    expect(buildSingleBookPrompt({ book, framework, angle: '故事式' })).toContain('故事式')
  })

  it('条目编号连续无重号', () => {
    for (const p of [
      buildSingleBookPrompt({ book, framework }),
      buildSingleBookPrompt({ book, framework, angle: '故事式', openTitleText: '今天分享的是' }),
    ]) {
      const nums = p.split('\n').map((l) => /^(\d+)\. /.exec(l)?.[1]).filter(Boolean).map(Number)
      expect(nums).toEqual(nums.map((_, i) => i + 1))
    }
  })
})

// generateScript() 主流程接线集成测试：variables.themeBook 存在时走单本路径。
// mock 与夹具沿用 generateScript.align.test.ts 的写法（DB 集成 + llmComplete mock）。
describe('generateScript：单本模式接线', () => {
  const frameworkIds: string[] = []
  const taskIds: string[] = []

  afterAll(async () => {
    await prisma.generatedSegment.deleteMany({ where: { generationTaskId: { in: taskIds } } })
    await prisma.generationTask.deleteMany({ where: { id: { in: taskIds } } })
    await prisma.copyFramework.deleteMany({ where: { id: { in: frameworkIds } } })
  })

  // 快闪模板：segCount=6，与 align 测试同规格，便于对照。
  async function makeFramework() {
    const fw = await prisma.copyFramework.create({
      data: {
        frameworkText: '开头钩子+逐段展开，语气亲切',
        overlayTemplate: { __templateParams: { mode: 'flash', open: { titleText: '今天分享的是' } } } as never,
        suggestedSegmentCount: 6,
        maxLines: 10,
        maxTotalChars: 200,
      },
    })
    frameworkIds.push(fw.id)
    return fw
  }

  async function makeTask(frameworkId: string, variables: Record<string, unknown>) {
    const task = await prisma.generationTask.create({
      data: { subject: '走出低谷期', frameworkId, variables: variables as never },
    })
    taskIds.push(task.id)
    return task
  }

  async function segmentsOf(taskId: string) {
    return prisma.generatedSegment.findMany({ where: { generationTaskId: taskId }, orderBy: { seqNo: 'asc' } })
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

  it('variables.themeBook 存在 → 所有正文段挂主题书，且 prompt 不含陪衬书名、不含书序号要求', async () => {
    const fw = await makeFramework()
    const themeBook = { title: '被讨厌的勇气', author: '岸见一郎' }
    const task = await makeTask(fw.id, {
      books: [{ title: '陪衬甲' }, { title: '陪衬乙' }, themeBook],
      themeBook,
    })
    // 单本路径不要求书序号标记，LLM 直接返回 6 行纯文案
    mockLlmComplete.mockResolvedValue('开场白一句\n正文二句\n正文三句\n正文四句\n正文五句\n正文六句')

    await generateScript(task.id)

    const segs = await segmentsOf(task.id)
    expect(segs.length).toBeGreaterThan(0)
    expect(segs.every((s) => s.bookTitle === '被讨厌的勇气' && s.bookAuthor === '岸见一郎')).toBe(true)

    const prompt = mockLlmComplete.mock.calls[0][0].prompt as string
    expect(prompt).not.toContain('陪衬甲')
    expect(prompt).not.toContain('陪衬乙')
    expect(prompt).not.toContain('书序号')
  })

  it('themeBook 缺失 → 走多本路径，书序号标记仍生效（行为与今天一致）', async () => {
    const fw = await makeFramework()
    const BOOKS = [{ title: '甲书', author: '甲作者' }, { title: '乙书', author: '乙作者' }, { title: '丙书' }]
    const task = await makeTask(fw.id, { books: BOOKS })
    mockLlmComplete.mockResolvedValue('0|开场白\n1|甲书一句\n1|甲书二句\n1|甲书三句\n2|乙书一句\n3|丙书一句')

    await generateScript(task.id)

    const segs = await segmentsOf(task.id)
    const titles = segs.map((s) => s.bookTitle ?? null)
    expect(titles).toEqual([null, '甲书', '甲书', '甲书', '乙书', '丙书'])
    // 有鉴别力：不是全部相同（区别于单本路径）
    expect(new Set(titles.filter(Boolean)).size).toBeGreaterThan(1)
  })

  it('scriptMode=imitate 且有 themeBook → 仍走仿写路径，themeBook 不劫持 manual/imitate', async () => {
    const fw = await makeFramework()
    const themeBook = { title: '被讨厌的勇气', author: '岸见一郎' }
    const task = await makeTask(fw.id, {
      books: [{ title: '陪衬甲' }, themeBook],
      themeBook,
      scriptMode: 'imitate',
      customScript: '参考文案示例，语气亲切。',
    })
    mockLlmComplete.mockResolvedValue('开场白\n仿写正文一句')

    await generateScript(task.id)

    const prompt = mockLlmComplete.mock.calls[0][0].prompt as string
    expect(prompt).toContain('参考文案示例，语气亲切。')
    // 单本提示词的特征串「不得提及」不应出现——证明没有误走单本路径
    expect(prompt).not.toContain('不得提及')
  })

  it('运营手填书单（有 books、无 themeBook）→ 多本路径，零回归（位置均分）', async () => {
    const fw = await makeFramework()
    const BOOKS = [{ title: '甲书' }, { title: '乙书' }, { title: '丙书' }]
    const task = await makeTask(fw.id, { books: BOOKS })
    // 不带标记 → 走位置均分兜底
    mockLlmComplete.mockResolvedValue('甲书一句\n甲书二句\n乙书一句\n乙书二句\n丙书一句\n丙书二句')

    await generateScript(task.id)

    const segs = await segmentsOf(task.id)
    const titles = segs.map((s) => s.bookTitle ?? null)
    // allocateBookIndexes(6,3) = [0,0,1,1,2,2]
    expect(titles).toEqual(['甲书', '甲书', '乙书', '乙书', '丙书', '丙书'])
  })
})

// 实测问题：给 AI 的字数预算是默认 220 字(该有的 2.3 倍),AI 按预算写满,
// 只能靠复述《活着》的情节(福贵、凤霞、老牛)来填字数。两处都要治。
describe('buildSingleBookPrompt —— 字数与剧透约束', () => {
  const framework = { frameworkText: '框架', segCount: 4, maxLines: 8, maxTotalChars: 89 }
  const book = { title: '活着', author: '余华' }

  it('给出每段平均字数,而非只给总数(只给总数会让模型把字堆在最后一段)', () => {
    const p = buildSingleBookPrompt({ book, framework })
    expect(p).toContain('89 字')
    expect(p).toContain('每段约 22 字')
  })

  it('明确禁止复述情节/人物/结局', () => {
    const p = buildSingleBookPrompt({ book, framework })
    expect(p).toContain('不要复述')
    expect(p).toContain('情节')
    expect(p).toContain('结局')
  })

  it('强调宁可少写不可超', () => {
    expect(buildSingleBookPrompt({ book, framework })).toContain('宁可少写')
  })
})
