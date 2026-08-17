// select-books：学员填一个书名/主题 → AI 配齐真实存在的完整书单，写回 task.variables.books
// （形状与运营手填书单完全一致），随后接力 generate-script。
//
// 三条硬约束（详见 docs/superpowers/specs/2026-08-18-ai-booklist-selection-design.md）：
// 1. 运营已手填书单（variables.books 非空）→ 原样跳过，直接入队，零回归。
// 2. 本步骤绝不能让生成任务失败：每个外部调用（联网 LLM）都单独 try/catch，任一环节
//    失败都降级而不是抛出；全部失败时兜底为「只用学员自己那本」。
// 3. 学员输入那本书永远出现且排第一——不是"大概率排第一"，是结构上保证：
//    候选池在传给 pickSubset 之前先把学员那本剔除掉（避免被随机洗牌吞掉或排到别处），
//    随机只从"AI 配的其余名额"里选，选完再把学员那本挂到最前面。
// 4.（fix round 1）scriptMode 为 manual/imitate 的任务：subject 此时是从学员粘贴的文案里
//    截出来的片段（见 web/app/api/generate/route.ts 的 finalSubject 兜底逻辑），不是书名/主题，
//    走 AI 选书只会白烧联网检索、且一旦模型误判 YES 就会把文案碎片当真书写进 BookLibrary，
//    污染书库的长期准确性（downstream 的 booksForAssign 本就只在 scriptMode==='auto' 时采用
//    books，manual/imitate 走这一步纯属浪费）。同「规则1」一样原样跳过、直接入队。
import {
  prisma,
  llmComplete,
  getCapabilityConfig,
  isMockMode,
  enqueueGen,
  findBookByTitle,
  findBooksByTheme,
  upsertBook,
  pickSubset,
  parseBookList,
  dedupeBooks,
  resolveBookCount,
  type PickedBook,
} from '@mixcut/db'
import { readScriptMode } from './generateScript'

type BookOut = PickedBook

function normalizeTitleLocal(title: string): string {
  return String(title ?? '').replace(/[《》]/g, '').trim()
}

// 分隔符用转义 NUL（源码里是 \, x, 0, 0 四个可打印 ASCII 字符，运行时才是 NUL 字节），
// 与 bookPick.ts 的 dedupeBooks 去重 key 统一：NUL 不可能出现在真实书名/作者里，
// 用空格等可打印字符当分隔符则不然（"活着 " + "余" 与 "活着" + " 余" 会撞出同一个 key）。
function bookKey(b: { title: string; author: string }): string {
  return `${normalizeTitleLocal(b.title)}\x00${b.author.trim()}`
}

function excludeBook(pool: PickedBook[], book: { title: string; author: string }): PickedBook[] {
  const key = bookKey(book)
  return pool.filter((b) => bookKey(b) !== key)
}

/** variables.books 已存在且非空 → 运营手填模式，本步骤不得介入 */
export function hasManualBooks(variables: unknown): boolean {
  if (!variables || typeof variables !== 'object' || Array.isArray(variables)) return false
  const books = (variables as Record<string, unknown>).books
  return Array.isArray(books) && books.length > 0
}

/** 学员输入是否真实存在的联网查证 prompt：命中返回作者姓名，否则只回 NO */
export function buildVerifySubjectPrompt(subject: string): string {
  return `请判断《${subject}》是否是一本真实存在的书。如果是，请只回复该书的作者姓名，不要输出任何其它文字；如果不是真实存在的书或你无法确认，请只回复 NO。`
}

/** 解析查证响应：NO / 空 / 明显是解释性长文本（非纯作者名）一律视为查证不通过 */
export function parseVerifiedAuthor(raw: string): string | null {
  if (typeof raw !== 'string') return null
  const trimmed = raw.trim()
  if (!trimmed) return null
  if (/^no$/i.test(trimmed)) return null
  const author = trimmed.replace(/^作者[:：]\s*/, '').trim()
  if (!author) return null
  // 真实作者名不含换行/中英文标点、且不会太长；命中任一特征视为"解释性文字"而非纯作者名，剔除。
  if (author.length > 20 || /[\n，。；：、！？,.;:!?]/.test(author)) return null
  return author
}

/** 候选书二次校验 prompt：只要求回 YES/NO */
export function buildVerifyCandidatePrompt(book: { title: string; author: string }): string {
  return `请判断《${book.title}》这本书是否真实存在，且作者是否为「${book.author}」。只回复 YES 或 NO，不要输出任何其它文字。`
}

export function parseYesNo(raw: string): boolean {
  return typeof raw === 'string' && /^\s*yes\b/i.test(raw.trim())
}

/** 联网推荐同主题真实书目的 prompt，要求纯 JSON 数组 */
export function buildRecommendPrompt(theme: string, need: number): string {
  return [
    `请推荐 ${need} 本与主题「${theme}」相关、真实存在的书籍（不要虚构）。`,
    '严格以 JSON 数组格式输出，每个元素形如 {"title":"书名","author":"作者","points":"一句话推荐要点"}，不要输出 JSON 之外的任何文字或代码块标记。',
  ].join('\n')
}

// mock 模式固定夹具：不得走 llmComplete 通用 mock（那是无关的固定文案），本步骤自带真实书名。
const MOCK_BOOK_FIXTURE: BookOut[] = [
  { title: '活着', author: '余华', points: '苦难中的生命韧性' },
  { title: '被讨厌的勇气', author: '岸见一郎', points: '课题分离，为自己而活' },
  { title: '百年孤独', author: '加西亚·马尔克斯', points: '魔幻现实中的家族宿命' },
  { title: '小王子', author: '安托万·德·圣-埃克苏佩里', points: '成年人心底的纯真' },
  { title: '思考,快与慢', author: '丹尼尔·卡尼曼', points: '两套思维系统如何塑造决策' },
  { title: '人间失格', author: '太宰治', points: '边缘人格的自白书' },
  { title: '月亮与六便士', author: '威廉·萨默塞特·毛姆', points: '理想与世俗的取舍' },
  { title: '追风筝的人', author: '卡勒德·胡赛尼', points: '救赎与友谊的重量' },
]

/** mock 模式专用：纯函数，零网络/零 DB，学员那本固定排第一 */
export function buildMockBookList(subject: string, n: number): BookOut[] {
  const studentBook: BookOut = { title: normalizeTitleLocal(subject), author: '' }
  const rest = excludeBook(MOCK_BOOK_FIXTURE, studentBook).slice(0, Math.max(0, n - 1))
  return [studentBook, ...rest].slice(0, Math.max(1, n))
}

/** 解析学员输入：库内命中直接用；未命中联网查证；查不到则以原文为书名、作者留空继续 */
async function resolveStudentBook(subject: string): Promise<BookOut> {
  try {
    const hit = await findBookByTitle(subject)
    if (hit) return { title: hit.title, author: hit.author, ...(hit.points ? { points: hit.points } : {}) }
  } catch (err) {
    console.warn('[gen] select-books: findBookByTitle 失败，继续走联网查证', err)
  }

  try {
    const raw = await llmComplete({ prompt: buildVerifySubjectPrompt(subject), enableSearch: true, maxTokens: 60 })
    const author = parseVerifiedAuthor(raw)
    if (author) {
      try {
        const saved = await upsertBook({ title: subject, author, theme: subject, source: 'ai' })
        return { title: saved.title, author: saved.author, ...(saved.points ? { points: saved.points } : {}) }
      } catch (err) {
        console.warn('[gen] select-books: upsertBook(学员书) 失败，仍使用查证结果', err)
        return { title: normalizeTitleLocal(subject), author }
      }
    }
  } catch (err) {
    console.warn('[gen] select-books: 学员输入联网查证失败，回退原文', err)
  }

  return { title: normalizeTitleLocal(subject), author: '' }
}

/** 候选池：书库同主题召回 + 不足时联网推荐并二次校验；学员那本始终被排除在外（外层负责固定排第一） */
async function collectCandidates(theme: string, studentBook: BookOut, n: number): Promise<PickedBook[]> {
  let pool: PickedBook[] = []
  try {
    const rows = await findBooksByTheme(theme, n * 2)
    pool = rows.map((r) => ({ title: r.title, author: r.author, ...(r.points ? { points: r.points } : {}) }))
  } catch (err) {
    console.warn('[gen] select-books: findBooksByTheme 失败', err)
  }
  pool = excludeBook(pool, studentBook)

  const need = n - 1 - pool.length
  if (need > 0) {
    try {
      const raw = await llmComplete({ prompt: buildRecommendPrompt(theme, need), enableSearch: true, maxTokens: 800 })
      const recommended = dedupeBooks(parseBookList(raw))
      const verified: PickedBook[] = []
      for (const b of recommended) {
        let ok = false
        try {
          const yn = await llmComplete({ prompt: buildVerifyCandidatePrompt(b), enableSearch: true, maxTokens: 20 })
          ok = parseYesNo(yn)
        } catch (err) {
          console.warn('[gen] select-books: 候选书二次校验请求失败，剔除该本', b, err)
          continue
        }
        if (!ok) continue
        try {
          const saved = await upsertBook({ title: b.title, author: b.author, theme, ...(b.points ? { points: b.points } : {}), source: 'ai' })
          verified.push({ title: saved.title, author: saved.author, ...(saved.points ? { points: saved.points } : {}) })
        } catch (err) {
          console.warn('[gen] select-books: upsertBook(候选书) 失败，仍使用未沉淀结果', b, err)
          verified.push(b)
        }
      }
      pool = excludeBook(dedupeBooks([...pool, ...verified]), studentBook)
    } catch (err) {
      console.warn('[gen] select-books: 联网推荐候选书失败，仅使用书库候选', err)
    }
  }

  return pool
}

async function writeBooksAndEnqueue(genTaskId: string, variables: unknown, books: BookOut[]): Promise<void> {
  const vars: Record<string, unknown> =
    variables && typeof variables === 'object' && !Array.isArray(variables) ? { ...(variables as Record<string, unknown>) } : {}
  vars.books = books
  await prisma.generationTask.update({ where: { id: genTaskId }, data: { variables: vars as never } })
  await enqueueGen('generate-script', { genTaskId })
}

export async function selectBooks(genTaskId: string): Promise<void> {
  const task = await prisma.generationTask.findUniqueOrThrow({
    where: { id: genTaskId },
    include: { framework: true },
  })

  // 规则1：运营已手填书单 → 原样跳过，直接入队，零回归关键路径。
  if (hasManualBooks(task.variables)) {
    await enqueueGen('generate-script', { genTaskId })
    return
  }

  // 规则4：manual/imitate 文案模式下 subject 不是书名/主题，AI 选书没有意义，
  // 且会浪费联网检索、有污染书库风险 → 同样原样跳过，直接入队。
  const scriptMode = readScriptMode(task.variables)
  if (scriptMode === 'manual' || scriptMode === 'imitate') {
    await enqueueGen('generate-script', { genTaskId })
    return
  }

  const subject = task.subject
  const n = resolveBookCount(task.framework.overlayTemplate)

  const cfg = await getCapabilityConfig('llm')
  if (isMockMode(cfg)) {
    await writeBooksAndEnqueue(genTaskId, task.variables, buildMockBookList(subject, n))
    return
  }

  const studentBook = await resolveStudentBook(subject)

  let books: BookOut[] = [studentBook]
  if (n > 1) {
    const pool = await collectCandidates(subject, studentBook, n)
    const picked = pickSubset(pool, n - 1, genTaskId)
    books = [studentBook, ...picked]
  }

  await writeBooksAndEnqueue(genTaskId, task.variables, books)
}
