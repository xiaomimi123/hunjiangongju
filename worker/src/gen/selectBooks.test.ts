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

import { prisma, upsertBook, isSameBook } from '@mixcut/db'
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

  it('（fix round 1 Minor 1）含句子标点的解释性文字 → 拒绝，视为无作者', () => {
    expect(parseVerifiedBook('这是一本非常好的书，作者是某某某，我强烈推荐大家阅读它。')).toEqual({})
    expect(parseVerifiedBook('作者不详，暂无法确认。')).toEqual({})
  })

  it('（fix round 1 Minor 1）模型如实说"不确定/查不到"等措辞 → 拒绝，不当作者名写库', () => {
    expect(parseVerifiedBook('这本书作者尚不确定')).toEqual({})
    expect(parseVerifiedBook('作者未知')).toEqual({})
    expect(parseVerifiedBook('无法确认')).toEqual({})
    expect(parseVerifiedBook('不清楚')).toEqual({})
    expect(parseVerifiedBook('抱歉，我不知道')).toEqual({})
  })

  it('（fix round 1 Minor 1）合法的顿号分隔多作者仍然通过', () => {
    expect(parseVerifiedBook('岸见一郎、古贺史健')).toEqual({ author: '岸见一郎、古贺史健' })
  })

  it('（fix round 2）真实作者名（含缩写点/间隔号/方括号国籍前缀）都应通过，不被误判为解释性文字', () => {
    expect(parseVerifiedBook('岸见一郎、古贺史健')).toEqual({ author: '岸见一郎、古贺史健' })
    expect(parseVerifiedBook('维克多·E·弗兰克尔')).toEqual({ author: '维克多·E·弗兰克尔' })
    expect(parseVerifiedBook('[日]村上春树')).toEqual({ author: '[日]村上春树' })
    expect(parseVerifiedBook('余华')).toEqual({ author: '余华' })
    // 回归点：半角句点是西方作者名缩写的正常写法（J.K. Rowling 的中文版通常就印成"J.K.罗琳"），
    // fix round 1 把裸 "." 当句子标点拒绝，误伤了这类名字——不能再退回那个状态。
    expect(parseVerifiedBook('J.K.罗琳')).toEqual({ author: 'J.K.罗琳' })
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
    // 单本模式：主题书排末位（最后一张定格）而非首位，见 2026-08-18-single-book-mode 设计。
    expect(books[books.length - 1]).toEqual({ title: 'MOCK模式选题', author: '' })
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
    // 单本模式：主题书排末位而非首位。
    expect(books[books.length - 1]).toEqual({ title: studentTitle, author: '库内作者' })
  })
})

describe('selectBooks：规则3 —— 学员输入本身始终会出现且排末位', () => {
  it('候选池远多于所需本数、发生洗牌时，学员那本仍固定排末位且不被挤出', async () => {
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
    // 单本模式：主题书排末位而非首位。
    expect(books[books.length - 1]).toEqual({ title: studentTitle, author: '固定第一作者' })
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
    // 单本模式：主题书排末位而非首位。
    expect(books[books.length - 1]).toEqual({ title: subject, author: '查证作者乙' })
    const titles = books.map((b) => b.title)
    expect(titles).toContain('主题候选甲')
    expect(titles).toContain('主题候选乙')

    const savedRow = await prisma.bookLibrary.findFirst({ where: { title: subject } })
    expect(savedRow?.theme).toBe(theme)
  })

  // ★ 外文书名必须在**两侧**都拦住。
  //
  // 线上成片里出现过《The Brontë Myth》《Jane Eyre: New Casebooks》这类快闪卡。
  // 根因不在提示词：这些书是在「中文书名」约束加进提示词**之前**就沉淀进书库的，
  // collectCandidates 先从书库召回，所以提示词怎么改都清不掉它们。
  // 因此召回侧要过滤存量，写入侧要拦住新的——只做一侧都会漏。
  it('书库召回：主题下的外文书名被剔除，不会进快闪卡', async () => {
    const subject = '外文召回测试书'
    const theme = '外文召回主题'
    trackTheme(theme)
    await upsertBook({ title: 'The Brontë Myth', author: 'Lucasta Miller', theme })
    await upsertBook({ title: 'Jane Eyre: New Casebooks', author: 'Heather Glen', theme })
    await upsertBook({ title: '中文候选甲', author: '候选作者甲', theme })
    await upsertBook({ title: '中文候选乙', author: '候选作者乙', theme })

    const fw = await makeFramework(3)
    const task = await makeTask(subject, fw.id)
    mockLlmComplete.mockResolvedValueOnce(`查证作者|${theme}`)

    await selectBooks(task.id)

    const fresh = await prisma.generationTask.findUniqueOrThrow({ where: { id: task.id } })
    const titles = (fresh.variables as { books: { title: string }[] }).books.map((b) => b.title)
    expect(titles).not.toContain('The Brontë Myth')
    expect(titles).not.toContain('Jane Eyre: New Casebooks')
    expect(titles).toContain('中文候选甲')
    expect(titles).toContain('中文候选乙')
  })

  it('联网推荐：返回的外文书名既不入选也不沉淀进书库', async () => {
    const subject = '外文推荐测试书'
    const theme = '外文推荐主题'
    trackTheme(theme)
    const fw = await makeFramework(2)
    const task = await makeTask(subject, fw.id)
    // 第 1 次：查证学员书；第 2 次：推荐补位（书库此时是空的，必然要联网补）；
    // 之后每本候选还要过一次二次校验——**这个兜底不能省**：不给它值的话
    // mockResolvedValueOnce 用尽后返回 undefined，parseYesNo 判否，两本书都被剔掉，
    // 这条断言就会在「过滤器根本没生效」时照样绿（我第一版就是这么假绿的）。
    mockLlmComplete.mockResolvedValueOnce(`查证作者|${theme}`)
    mockLlmComplete.mockResolvedValueOnce(JSON.stringify([
      { title: 'The Madwoman in the Attic', author: 'Sandra Gilbert' },
      { title: '中文推荐书', author: '中文作者' },
    ]))
    mockLlmComplete.mockResolvedValue('YES')

    await selectBooks(task.id)

    const fresh = await prisma.generationTask.findUniqueOrThrow({ where: { id: task.id } })
    const titles = (fresh.variables as { books: { title: string }[] }).books.map((b) => b.title)
    expect(titles).not.toContain('The Madwoman in the Attic')
    // 沉淀侧同样要干净，否则这本书下次会从书库被召回，等于绕过了本次拦截
    expect(await prisma.bookLibrary.count({ where: { title: 'The Madwoman in the Attic' } })).toBe(0)
    // 正对照：中文那本走完了推荐→校验→沉淀的完整链路，证明这条路径真的跑到了
    expect(titles).toContain('中文推荐书')
    expect(await prisma.bookLibrary.count({ where: { title: '中文推荐书' } })).toBe(1)
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

  it('（回归）通过查证成功拿到作者的新路径，学员书仍固定排末位', async () => {
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
    // 单本模式：主题书排末位而非首位。
    expect(books[books.length - 1]).toEqual({ title: subject, author: '固定作者' })
  })

  it('（fix round 1 覆盖）n>1 时学员书从候选池借到作者后，同一本书不会在候选部分重复出现', async () => {
    // 这条端到端覆盖的正是本批次要修的场景：学员书（短标题）从候选池借到作者后，候选池自己的
    // 召回（collectCandidates 内部同样用 theme=subject 兜底 findBooksByTheme）会再次读到那本"全名版"，
    // 如果排除逻辑只按精确字符串比较（旧 bookKey 方案），全名版不会被当成"已经是学员书了"而排除，
    // 最终书单里会同一本书出现两次。
    //
    // n=4（即 n-1=3 个候选名额）是刻意选的：
    // - 正确实现（isSameBook 排除）下，候选池排除全名版后只剩 2 本"真候选"（<3，pickSubset 全部返回）；
    // - 若排除退化为精确字符串匹配，候选池会保留全名版凑成 3 本（=3，pickSubset 同样全部返回）。
    // 两种情况请求数都 >= 候选池大小，pickSubset 必然返回全部候选——断言结果因此与洗牌顺序/种子无关，
    // 不需要固定 genTaskId 也能确定性验证："排除退化" 这条路径必然会让全名版进最终书单。
    const studentTitle = '重复防护测试书'
    trackTheme(studentTitle)
    await upsertBook({ title: `${studentTitle}：完整版`, author: '重复防护作者', theme: studentTitle, points: '重复防护要点' })
    for (const t of ['重复防护候选1', '重复防护候选2']) {
      await upsertBook({ title: t, author: `作者-${t}`, theme: studentTitle })
    }

    const fw = await makeFramework(4)
    const task = await makeTask(studentTitle, fw.id)
    mockLlmComplete.mockRejectedValue(new Error('查证服务不可用')) // 两次查证都失败，强制走 L2 候选池借用

    await selectBooks(task.id)

    const fresh = await prisma.generationTask.findUniqueOrThrow({ where: { id: task.id } })
    const books = (fresh.variables as { books: { title: string; author: string; points?: string }[] }).books
    // 学员书仍固定排末位（单本模式），且确实借到了作者
    expect(books[books.length - 1]).toEqual({ title: studentTitle, author: '重复防护作者', points: '重复防护要点' })
    // 核心断言：借出作者的"全名版"与学员书是 isSameBook 意义下的同一本书，最终书单里只能算一次名额
    const sameBookCount = books.filter((b) => isSameBook(b, { title: studentTitle, author: '重复防护作者' })).length
    expect(sameBookCount).toBe(1)
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

describe('selectBooks：单本模式——主题书排末位并单独标出', () => {
  it('主题书位于 variables.books 末位，themeBook 与之一致', async () => {
    const studentTitle = '被讨厌的勇气'
    trackTheme(studentTitle)
    await upsertBook({ title: studentTitle, author: '岸见一郎', theme: studentTitle })
    await upsertBook({ title: '陪衬书甲', author: '陪衬作者甲', theme: studentTitle })
    await upsertBook({ title: '陪衬书乙', author: '陪衬作者乙', theme: studentTitle })

    const fw = await makeFramework(3)
    const task = await makeTask(studentTitle, fw.id)

    await selectBooks(task.id)

    expect(mockLlmComplete).not.toHaveBeenCalled()
    const fresh = await prisma.generationTask.findUniqueOrThrow({ where: { id: task.id } })
    const vars = fresh.variables as {
      books: { title: string; author: string }[]
      themeBook: { title: string; author: string }
    }
    expect(vars.books.length).toBe(3)
    expect(vars.books[vars.books.length - 1].title).toBe(studentTitle)
    expect(vars.themeBook.title).toBe(studentTitle)
    // 有区分力的关键断言：排在首位/中间的书里不能再混进主题书（否则"排末位"改动前也会通过）
    expect(vars.books.slice(0, -1).some((b) => b.title === studentTitle)).toBe(false)
  })

  it('__bookCount 为 1 时只有主题书，themeBook 仍写入', async () => {
    const studentTitle = '单本主题书测试'
    trackTheme(studentTitle)
    await upsertBook({ title: studentTitle, author: '单本测试作者', theme: studentTitle })

    const fw = await makeFramework(1)
    const task = await makeTask(studentTitle, fw.id)

    await selectBooks(task.id)

    // findBookByTitle 精确命中，走不到查证/推荐/校验任何一次 llmComplete 调用
    expect(mockLlmComplete).not.toHaveBeenCalled()
    const fresh = await prisma.generationTask.findUniqueOrThrow({ where: { id: task.id } })
    const vars = fresh.variables as { books: unknown[]; themeBook: unknown }
    expect(vars.books.length).toBe(1)
    expect(vars.books[0]).toEqual(vars.themeBook)
  })

  it('运营手填书单 → 不写 themeBook（多本路径零回归）', async () => {
    const fw = await makeFramework(5)
    const manualBooks = [{ title: '运营手填书-单本用例', author: '运营作者' }]
    const task = await makeTask('这个字段此时应被忽略-单本用例', fw.id, { books: manualBooks })

    await selectBooks(task.id)

    expect(mockLlmComplete).not.toHaveBeenCalled()
    const fresh = await prisma.generationTask.findUniqueOrThrow({ where: { id: task.id } })
    const vars = fresh.variables as Record<string, unknown>
    expect(vars.themeBook).toBeUndefined()
    expect(vars.books).toEqual(manualBooks)
  })

  it('mock 模式 → 主题书同样在末位并写 themeBook', async () => {
    mockIsMockMode.mockReturnValue(true)
    const fw = await makeFramework(3)
    const task = await makeTask('MOCK单本选题', fw.id)

    await selectBooks(task.id)

    expect(mockLlmComplete).not.toHaveBeenCalled()
    const fresh = await prisma.generationTask.findUniqueOrThrow({ where: { id: task.id } })
    const vars = fresh.variables as {
      books: { title: string; author: string }[]
      themeBook: { title: string; author: string }
    }
    expect(vars.books.length).toBe(3)
    expect(vars.books[vars.books.length - 1]).toEqual({ title: 'MOCK单本选题', author: '' })
    expect(vars.themeBook).toEqual({ title: 'MOCK单本选题', author: '' })
    expect(vars.books.slice(0, -1).some((b) => b.title === 'MOCK单本选题')).toBe(false)
  })
})

// 线上事故：学员填《简爱》,主题词提取失败 → theme 回退成书名「简爱」→
// 提示词「推荐 8 本与主题『简爱』相关的书」被联网模型理解成「关于《简爱》的书」,
// 返回 《Jane Eyre: New Casebooks》《The Brontë Myth》《The Madwoman in the Attic》…
// 一整屏英文学术专著。书封快闪上全是英文书名。
describe('buildRecommendPrompt —— 中文大众读物约束', () => {
  it('要求中文书名（外文原著用通行中译名）', () => {
    const p = buildRecommendPrompt('自我成长', 8)
    expect(p).toContain('中文')
    expect(p).toContain('中文译名')
  })

  it('明确排除研究/评论/导读类,避免「关于某本书的书」', () => {
    const p = buildRecommendPrompt('简爱', 8)
    expect(p).toContain('研究')
    expect(p).toContain('评论')
    // theme 本身是书名时,要的是气质相近的**其它书**
    expect(p).toContain('其它书')
  })

  it('保留原有契约：本数与纯 JSON 数组格式', () => {
    const p = buildRecommendPrompt('亲密关系', 5)
    expect(p).toContain('5 本')
    expect(p).toContain('JSON 数组')
    expect(p).toContain('{"title":"书名","author":"作者","points":"一句话推荐要点"}')
  })
})
