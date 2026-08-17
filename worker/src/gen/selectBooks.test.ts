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

import { prisma, upsertBook } from '@mixcut/db'
import {
  selectBooks,
  hasManualBooks,
  parseVerifiedAuthor,
  parseVerifiedBook,
  buildVerifySubjectPrompt,
  parseYesNo,
  buildVerifyCandidatePrompt,
  buildRecommendPrompt,
  buildMockBookList,
} from './selectBooks'

const frameworkIds: string[] = []
const taskIds: string[] = []
const themes: string[] = []

afterAll(async () => {
  await prisma.generationTask.deleteMany({ where: { id: { in: taskIds } } })
  await prisma.copyFramework.deleteMany({ where: { id: { in: frameworkIds } } })
  if (themes.length > 0) {
    await prisma.bookLibrary.deleteMany({ where: { theme: { in: themes } } })
  }
})

async function makeFramework(bookCount?: number) {
  const fw = await prisma.copyFramework.create({
    data: {
      frameworkText: '测试框架文本',
      overlayTemplate: bookCount !== undefined ? { __bookCount: bookCount } : {},
    },
  })
  frameworkIds.push(fw.id)
  return fw
}

async function makeTask(subject: string, frameworkId: string, variables?: unknown, id?: string) {
  const task = await prisma.generationTask.create({
    data: {
      ...(id ? { id } : {}),
      subject,
      frameworkId,
      variables: (variables ?? undefined) as never,
    },
  })
  taskIds.push(task.id)
  return task
}

function trackTheme(theme: string) {
  if (!themes.includes(theme)) themes.push(theme)
}

beforeEach(() => {
  mockLlmComplete.mockReset()
  mockIsMockMode.mockReset()
  mockGetCapabilityConfig.mockReset()
  mockEnqueueGen.mockReset()
  mockGetCapabilityConfig.mockResolvedValue({ capability: 'llm', baseUrl: '', apiKey: '', model: '', enabled: false, extra: {} })
  mockIsMockMode.mockReturnValue(false)
})

describe('纯函数：hasManualBooks', () => {
  it('variables.books 非空数组 → true', () => {
    expect(hasManualBooks({ books: [{ title: 'A', author: 'B' }] })).toBe(true)
  })
  it('variables 为空/无 books/空数组 → false', () => {
    expect(hasManualBooks(null)).toBe(false)
    expect(hasManualBooks(undefined)).toBe(false)
    expect(hasManualBooks({})).toBe(false)
    expect(hasManualBooks({ books: [] })).toBe(false)
    expect(hasManualBooks({ books: 'x' })).toBe(false)
  })
})

describe('纯函数：parseVerifiedAuthor', () => {
  it('回复 NO（大小写不敏感）→ null', () => {
    expect(parseVerifiedAuthor('NO')).toBeNull()
    expect(parseVerifiedAuthor('no')).toBeNull()
    expect(parseVerifiedAuthor('  No  ')).toBeNull()
  })
  it('空字符串 → null', () => {
    expect(parseVerifiedAuthor('')).toBeNull()
    expect(parseVerifiedAuthor('   ')).toBeNull()
  })
  it('过长/含换行的解释性文字 → null（防止把废话当作者名）', () => {
    expect(parseVerifiedAuthor('这是一本非常好的书，作者是某某某，我强烈推荐大家阅读它。')).toBeNull()
    expect(parseVerifiedAuthor('张三\n这是解释')).toBeNull()
  })
  it('正常作者名 → 原样返回（去除"作者："前缀）', () => {
    expect(parseVerifiedAuthor('余华')).toBe('余华')
    expect(parseVerifiedAuthor('作者：余华')).toBe('余华')
    expect(parseVerifiedAuthor(' 岸见一郎 ')).toBe('岸见一郎')
  })
})

describe('纯函数：parseVerifiedBook', () => {
  it('解析 作者|主题词', () => {
    expect(parseVerifiedBook('岸见一郎、古贺史健|自我成长')).toEqual({ author: '岸见一郎、古贺史健', theme: '自我成长' })
  })
  it('只有作者(无分隔符) → 仅 author', () => {
    expect(parseVerifiedBook('余华')).toEqual({ author: '余华' })
  })
  it('NO / 空 → 空对象', () => {
    expect(parseVerifiedBook('NO')).toEqual({})
    expect(parseVerifiedBook('   ')).toEqual({})
  })
  it('主题词过长时丢弃主题词但保留作者', () => {
    const long = '这是一个非常长的主题描述超过限制'
    expect(parseVerifiedBook(`余华|${long}`)).toEqual({ author: '余华' })
  })
  it('去掉包裹的书名号/引号与首尾空白', () => {
    expect(parseVerifiedBook(' 「余华」 | 「文学」 ')).toEqual({ author: '余华', theme: '文学' })
  })
})

describe('纯函数：parseYesNo', () => {
  it('YES 开头（大小写不敏感）→ true', () => {
    expect(parseYesNo('YES')).toBe(true)
    expect(parseYesNo('yes')).toBe(true)
    expect(parseYesNo(' Yes ')).toBe(true)
  })
  it('其它一律 false', () => {
    expect(parseYesNo('NO')).toBe(false)
    expect(parseYesNo('')).toBe(false)
    expect(parseYesNo('不确定')).toBe(false)
  })
})

describe('纯函数：prompt 构造包含关键信息', () => {
  it('buildVerifySubjectPrompt 包含书名，要求只回作者或 NO', () => {
    const p = buildVerifySubjectPrompt('活着')
    expect(p).toContain('活着')
    expect(p).toContain('NO')
  })
  it('buildVerifyCandidatePrompt 包含书名与作者，要求只回 YES/NO', () => {
    const p = buildVerifyCandidatePrompt({ title: '活着', author: '余华' })
    expect(p).toContain('活着')
    expect(p).toContain('余华')
    expect(p).toContain('YES')
    expect(p).toContain('NO')
  })
  it('buildRecommendPrompt 包含主题与本数，要求 JSON 数组', () => {
    const p = buildRecommendPrompt('心理成长', 3)
    expect(p).toContain('心理成长')
    expect(p).toContain('3')
    expect(p).toContain('JSON')
  })
})

describe('纯函数：buildMockBookList', () => {
  it('学员输入始终排第一，总长度等于 n，不发起任何调用', () => {
    const list = buildMockBookList('我的选题ABC', 4)
    expect(list.length).toBe(4)
    expect(list[0]).toEqual({ title: '我的选题ABC', author: '' })
  })
  it('n=1 时只含学员本书', () => {
    expect(buildMockBookList('单本测试', 1)).toEqual([{ title: '单本测试', author: '' }])
  })
})

describe('selectBooks：规则1 —— 运营手填书单必须原样跳过（零回归关键路径）', () => {
  it('variables.books 已存在且非空 → 不发起任何 LLM 调用，不改动 variables，直接入队 generate-script', async () => {
    const fw = await makeFramework(5)
    const manualBooks = [{ title: '运营手填书', author: '运营作者' }]
    const task = await makeTask('这个字段此时应被忽略', fw.id, { books: manualBooks, scriptMode: 'manual' })

    await selectBooks(task.id)

    expect(mockLlmComplete).not.toHaveBeenCalled()
    const fresh = await prisma.generationTask.findUniqueOrThrow({ where: { id: task.id } })
    expect(fresh.variables).toEqual({ books: manualBooks, scriptMode: 'manual' })
    expect(mockEnqueueGen).toHaveBeenCalledWith('generate-script', { genTaskId: task.id })
  })
})

describe('selectBooks：规则4（fix round 1）—— manual/imitate 文案模式跳过 AI 选书，避免浪费检索与污染书库', () => {
  it('scriptMode: imitate → 不调用 llmComplete，不写任何书库行，直接入队 generate-script', async () => {
    const fw = await makeFramework(3)
    // subject 模拟 route.ts 从粘贴文案里截出的片段（不是书名），imitate 模式下 books 字段本就为空
    const task = await makeTask('这段文案的开头几句被当作选题兜底', fw.id, {
      scriptMode: 'imitate',
      customScript: '这是学员粘贴用来仿写的参考文案全文……',
    })

    await selectBooks(task.id)

    expect(mockLlmComplete).not.toHaveBeenCalled()
    expect(
      await prisma.bookLibrary.count({ where: { title: '这段文案的开头几句被当作选题兜底' } })
    ).toBe(0)
    const fresh = await prisma.generationTask.findUniqueOrThrow({ where: { id: task.id } })
    // 跳过时不得触碰 variables（与规则1 一致：原样透传）
    expect(fresh.variables).toEqual({ scriptMode: 'imitate', customScript: '这是学员粘贴用来仿写的参考文案全文……' })
    expect(mockEnqueueGen).toHaveBeenCalledWith('generate-script', { genTaskId: task.id })
  })

  it('scriptMode: manual 且 books 为空/缺省 → 同样跳过 AI 选书，不调用 llmComplete，仍入队 generate-script', async () => {
    const fw = await makeFramework(3)
    const task = await makeTask('手动模式的选题片段', fw.id, {
      scriptMode: 'manual',
      customScript: '学员完全自己写的文案',
    })

    await selectBooks(task.id)

    expect(mockLlmComplete).not.toHaveBeenCalled()
    expect(await prisma.bookLibrary.count({ where: { title: '手动模式的选题片段' } })).toBe(0)
    const fresh = await prisma.generationTask.findUniqueOrThrow({ where: { id: task.id } })
    expect(fresh.variables).toEqual({ scriptMode: 'manual', customScript: '学员完全自己写的文案' })
    expect(mockEnqueueGen).toHaveBeenCalledWith('generate-script', { genTaskId: task.id })
  })

  it('scriptMode: manual 且 books 显式为空数组 → 走规则4 跳过（不是规则1，因为 hasManualBooks 要求非空数组）', async () => {
    const fw = await makeFramework(3)
    const task = await makeTask('手动模式空书单选题', fw.id, { scriptMode: 'manual', books: [] })

    await selectBooks(task.id)

    expect(mockLlmComplete).not.toHaveBeenCalled()
    expect(mockEnqueueGen).toHaveBeenCalledWith('generate-script', { genTaskId: task.id })
  })
})

describe('selectBooks：mock 模式 —— 自带 fixture，零网络调用', () => {
  it('返回固定夹具书目，长度等于目标本数，不调用 llmComplete', async () => {
    mockIsMockMode.mockReturnValue(true)
    const fw = await makeFramework(3)
    const task = await makeTask('MOCK模式选题', fw.id)

    await selectBooks(task.id)

    expect(mockLlmComplete).not.toHaveBeenCalled()
    const fresh = await prisma.generationTask.findUniqueOrThrow({ where: { id: task.id } })
    const books = (fresh.variables as { books: { title: string; author: string }[] }).books
    expect(books.length).toBe(3)
    expect(books[0]).toEqual({ title: 'MOCK模式选题', author: '' })
    expect(mockEnqueueGen).toHaveBeenCalledWith('generate-script', { genTaskId: task.id })
  })

  it('目标本数 N 来自 framework.overlayTemplate.__bookCount（这里用与其它用例不同的 N=6 验证接线）', async () => {
    mockIsMockMode.mockReturnValue(true)
    const fw = await makeFramework(6)
    const task = await makeTask('MOCK模式选题-N6', fw.id)

    await selectBooks(task.id)

    const fresh = await prisma.generationTask.findUniqueOrThrow({ where: { id: task.id } })
    const books = (fresh.variables as { books: unknown[] }).books
    expect(books.length).toBe(6)
  })

  it('（fix round 1 Minor 1）写回 books 时必须原样保留已有的其它 variables 字段，不得被覆盖丢失', async () => {
    mockIsMockMode.mockReturnValue(true)
    const fw = await makeFramework(2)
    const preexisting = { 标题: 'x', 副标题: 'y', 账号: '@z', voiceId: 'v1' }
    const task = await makeTask('变量保留测试选题', fw.id, preexisting)

    await selectBooks(task.id)

    const fresh = await prisma.generationTask.findUniqueOrThrow({ where: { id: task.id } })
    const vars = fresh.variables as Record<string, unknown>
    expect(vars.标题).toBe('x')
    expect(vars.副标题).toBe('y')
    expect(vars.账号).toBe('@z')
    expect(vars.voiceId).toBe('v1')
    expect(Array.isArray(vars.books)).toBe(true)
    expect((vars.books as unknown[]).length).toBe(2)
  })
})

describe('selectBooks：书库已命中该书 → 不发起联网调用', () => {
  it('学员输入精确命中书库 + 同主题候选已够 N 本 → llmComplete 全程未被调用', async () => {
    // 实现里 findBooksByTheme 的 theme 参数直接取自 task.subject（详见 selectBooks.ts 设计注释），
    // 因此候选书要能被召回，必须把 theme 打成与 studentTitle（=task.subject）完全相同的字符串。
    const studentTitle = '书库命中测试书'
    trackTheme(studentTitle)
    await upsertBook({ title: studentTitle, author: '库内作者', theme: studentTitle })
    await upsertBook({ title: '同主题候选书A', author: '候选作者A', theme: studentTitle })
    await upsertBook({ title: '同主题候选书B', author: '候选作者B', theme: studentTitle })

    const fw = await makeFramework(3)
    const task = await makeTask(studentTitle, fw.id)

    await selectBooks(task.id)

    expect(mockLlmComplete).not.toHaveBeenCalled()
    const fresh = await prisma.generationTask.findUniqueOrThrow({ where: { id: task.id } })
    const books = (fresh.variables as { books: { title: string; author: string }[] }).books
    expect(books.length).toBe(3)
    expect(books[0]).toEqual({ title: studentTitle, author: '库内作者' })
  })
})

describe('selectBooks：规则3 —— 学员输入本身始终作为第一本出现', () => {
  it('候选池远多于所需本数、发生洗牌时，学员那本仍固定排第一且不被挤出', async () => {
    const studentTitle = '固定第一测试书'
    trackTheme(studentTitle)
    await upsertBook({ title: studentTitle, author: '固定第一作者', theme: studentTitle })
    for (const t of ['候选1', '候选2', '候选3', '候选4', '候选5']) {
      await upsertBook({ title: t, author: `作者-${t}`, theme: studentTitle })
    }

    const fw = await makeFramework(3)
    const task = await makeTask(studentTitle, fw.id)

    await selectBooks(task.id)

    expect(mockLlmComplete).not.toHaveBeenCalled()
    const fresh = await prisma.generationTask.findUniqueOrThrow({ where: { id: task.id } })
    const books = (fresh.variables as { books: { title: string; author: string }[] }).books
    expect(books.length).toBe(3)
    expect(books[0]).toEqual({ title: studentTitle, author: '固定第一作者' })
    // 不能出现重复：学员那本不会又混进候选部分
    const keys = books.map((b) => `${b.title}\x00${b.author}`)
    expect(new Set(keys).size).toBe(books.length)
  })
})

describe('selectBooks：学员书作者三级兜底', () => {
  it('查证第一次失败、第二次成功 → 只调用两次查证，作者取到（n=1 避免 collectCandidates 引入额外调用）', async () => {
    const studentTitle = '重试成功测试书'
    const fw = await makeFramework(1)
    const task = await makeTask(studentTitle, fw.id)
    mockLlmComplete.mockRejectedValueOnce(new Error('第一次查证失败')).mockResolvedValueOnce('查证作者甲|重试主题词')
    trackTheme('重试主题词')

    await selectBooks(task.id)

    expect(mockLlmComplete).toHaveBeenCalledTimes(2)
    const fresh = await prisma.generationTask.findUniqueOrThrow({ where: { id: task.id } })
    const books = (fresh.variables as { books: { title: string; author: string }[] }).books
    expect(books[0]).toEqual({ title: studentTitle, author: '查证作者甲' })
  })

  it('查证两次都失败 → 从候选池按 isSameBook 命中全名版借用作者（n=1 避免额外调用）', async () => {
    const studentTitle = '候选借用测试书'
    trackTheme(studentTitle)
    // 预先沉淀一条"全名版"：与学员输入构成副标题前缀关系，theme 恰为 subject（三级兜底此时只能按 subject 兜底召回）
    await upsertBook({ title: `${studentTitle}：完整版`, author: '借用作者', theme: studentTitle, points: '借用要点' })

    const fw = await makeFramework(1)
    const task = await makeTask(studentTitle, fw.id)
    mockLlmComplete.mockRejectedValue(new Error('查证服务不可用'))

    await selectBooks(task.id)

    expect(mockLlmComplete).toHaveBeenCalledTimes(2)
    const fresh = await prisma.generationTask.findUniqueOrThrow({ where: { id: task.id } })
    const books = (fresh.variables as { books: { title: string; author: string }[] }).books
    expect(books[0]).toEqual({ title: studentTitle, author: '借用作者', points: '借用要点' })
  })

  it('三级都拿不到 → author 为空且该书未写入 BookLibrary', async () => {
    const studentTitle = '三级失败测试书'
    const fw = await makeFramework(1)
    const task = await makeTask(studentTitle, fw.id)
    mockLlmComplete.mockRejectedValue(new Error('查证服务不可用'))

    await selectBooks(task.id)

    const fresh = await prisma.generationTask.findUniqueOrThrow({ where: { id: task.id } })
    const books = (fresh.variables as { books: { title: string; author: string }[] }).books
    expect(books[0]).toEqual({ title: studentTitle, author: '' })
    expect(await prisma.bookLibrary.count({ where: { title: studentTitle } })).toBe(0)
  })

  it('查证返回「作者|主题词」→ 写库与后续召回都用主题词，而非 subject', async () => {
    const subject = '主题词召回测试书'
    const theme = '成长主题词'
    trackTheme(theme)
    // 预先沉淀两本已归入该主题词下的候选：只有 collectCandidates 用 theme（而非 subject）召回才会命中
    await upsertBook({ title: '主题候选甲', author: '候选作者甲', theme })
    await upsertBook({ title: '主题候选乙', author: '候选作者乙', theme })

    const fw = await makeFramework(3)
    const task = await makeTask(subject, fw.id)
    mockLlmComplete.mockResolvedValueOnce(`查证作者乙|${theme}`)

    await selectBooks(task.id)

    // need = n-1-pool.length = 2-2 = 0，书库候选已够，不必再联网推荐 → 只有 1 次查证调用
    expect(mockLlmComplete).toHaveBeenCalledTimes(1)
    const fresh = await prisma.generationTask.findUniqueOrThrow({ where: { id: task.id } })
    const books = (fresh.variables as { books: { title: string; author: string }[] }).books
    expect(books.length).toBe(3)
    expect(books[0]).toEqual({ title: subject, author: '查证作者乙' })
    const titles = books.map((b) => b.title)
    expect(titles).toContain('主题候选甲')
    expect(titles).toContain('主题候选乙')

    const savedRow = await prisma.bookLibrary.findFirst({ where: { title: subject } })
    expect(savedRow?.theme).toBe(theme)
  })

  it('查证只返回作者（无主题词）→ theme 回退为 subject，不硬失败', async () => {
    const subject = '仅作者回退测试书'
    trackTheme(subject)
    const fw = await makeFramework(1)
    const task = await makeTask(subject, fw.id)
    mockLlmComplete.mockResolvedValueOnce('仅作者甲')

    await selectBooks(task.id)

    const savedRow = await prisma.bookLibrary.findFirst({ where: { title: subject } })
    expect(savedRow?.author).toBe('仅作者甲')
    expect(savedRow?.theme).toBe(subject)
  })

  it('（回归）通过查证成功拿到作者的新路径，学员书仍固定排第一', async () => {
    const subject = '新路径固定第一测试书'
    const theme = '新路径主题词'
    trackTheme(theme)
    for (const t of ['新路径候选1', '新路径候选2', '新路径候选3', '新路径候选4']) {
      await upsertBook({ title: t, author: `作者-${t}`, theme })
    }
    const fw = await makeFramework(3)
    const task = await makeTask(subject, fw.id)
    mockLlmComplete.mockResolvedValueOnce(`固定作者|${theme}`)

    await selectBooks(task.id)

    const fresh = await prisma.generationTask.findUniqueOrThrow({ where: { id: task.id } })
    const books = (fresh.variables as { books: { title: string; author: string }[] }).books
    expect(books.length).toBe(3)
    expect(books[0]).toEqual({ title: subject, author: '固定作者' })
  })
})

describe('selectBooks：兜底 —— 联网全部失败仍不阻断任务', () => {
  it('学员输入未命中书库、书库无同主题候选、llmComplete 全程抛错 → variables.books 至少含学员那本，任务不 FAILED', async () => {
    mockLlmComplete.mockRejectedValue(new Error('联网检索服务不可用'))
    const fw = await makeFramework(4)
    const task = await makeTask('兜底测试-联网全失败的选题ZZZ', fw.id)

    await expect(selectBooks(task.id)).resolves.toBeUndefined()

    const fresh = await prisma.generationTask.findUniqueOrThrow({ where: { id: task.id } })
    expect(fresh.status).not.toBe('FAILED')
    const books = (fresh.variables as { books: { title: string; author: string }[] }).books
    expect(books.length).toBeGreaterThanOrEqual(1)
    expect(books[0]).toEqual({ title: '兜底测试-联网全失败的选题ZZZ', author: '' })
    expect(mockEnqueueGen).toHaveBeenCalledWith('generate-script', { genTaskId: task.id })
  })
})

describe('selectBooks：种子稳定性 —— 同任务重跑一致，不同任务书单不同', () => {
  it('同一 genTaskId 重跑两次，第二次跳过重算（variables.books 已非空）且结果与第一次完全一致', async () => {
    const studentTitle = '重跑稳定性测试书'
    trackTheme(studentTitle)
    await upsertBook({ title: studentTitle, author: '重跑作者', theme: studentTitle })
    for (const t of ['重跑候选1', '重跑候选2', '重跑候选3', '重跑候选4']) {
      await upsertBook({ title: t, author: `作者-${t}`, theme: studentTitle })
    }
    const fw = await makeFramework(3)
    const task = await makeTask(studentTitle, fw.id)

    await selectBooks(task.id)
    const afterFirst = await prisma.generationTask.findUniqueOrThrow({ where: { id: task.id } })

    await selectBooks(task.id)
    const afterSecond = await prisma.generationTask.findUniqueOrThrow({ where: { id: task.id } })

    expect(afterSecond.variables).toEqual(afterFirst.variables)
    expect(mockEnqueueGen).toHaveBeenCalledTimes(2)
  })

  it('不同 genTaskId + 同 subject → 候选部分的书单组合不同', async () => {
    const sharedSubject = '异任务共享选题主题'
    trackTheme(sharedSubject)
    await upsertBook({ title: sharedSubject, author: '共享选题作者', theme: sharedSubject })
    for (const t of ['异任务候选1', '异任务候选2', '异任务候选3', '异任务候选4', '异任务候选5', '异任务候选6']) {
      await upsertBook({ title: t, author: `作者-${t}`, theme: sharedSubject })
    }
    const fw = await makeFramework(3)
    // 用固定 id（而非让 Prisma 随机生成 uuid）：pickSubset 的种子就是 genTaskId，两个真随机 uuid
    // 在 6 选 2 的小候选池上偶尔会撞出相同子集（Fisher-Yates 的生日悖论），导致这条断言随机跑绿/跑红。
    // 固定 id 已用 pickSubset 实测确认对该候选池产出不同子集（同 Task 3 bookPick.test.ts 用
    // 'task-a'/'task-b' 固定种子验证"异 seed 结果不同"的做法一致），消除 flake 而不改变被测语义。
    const taskA = await makeTask(sharedSubject, fw.id, undefined, 'selectbooks-seed-task-a')
    const taskB = await makeTask(sharedSubject, fw.id, undefined, 'selectbooks-seed-task-b')

    await selectBooks(taskA.id)
    await selectBooks(taskB.id)

    const freshA = await prisma.generationTask.findUniqueOrThrow({ where: { id: taskA.id } })
    const freshB = await prisma.generationTask.findUniqueOrThrow({ where: { id: taskB.id } })
    expect(freshA.variables).not.toEqual(freshB.variables)
  })
})

describe('selectBooks：完成后入队 generate-script', () => {
  it('mock 模式与真实模式都会在结束时入队', async () => {
    mockIsMockMode.mockReturnValue(true)
    const fw = await makeFramework(2)
    const task = await makeTask('入队测试选题', fw.id)
    await selectBooks(task.id)
    expect(mockEnqueueGen).toHaveBeenCalledWith('generate-script', { genTaskId: task.id })
  })
})
