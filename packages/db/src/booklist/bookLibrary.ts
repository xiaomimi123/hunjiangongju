// 本地可运营维护的书库：AI 选书结果 / 人工审校后的 书名+作者 沉淀于此，供后续复用与召回。
import { Prisma } from '@prisma/client'
import { prisma } from '../client'

export interface BookRow {
  id: string
  title: string
  author: string
  theme: string | null
  points: string | null
  source: string
  /** 书封（/api/files/... 相对 URL）。为空表示还没有，生图时现做并回写。 */
  coverUrl: string | null
  /** 'upload'=运营上传的真实封面 / 'ai'=按框架画风生成的底图 */
  coverSource: string | null
}

/** 规范化书名：去掉书名号《》与首尾空白，用于统一存储与查询。
 * 导出供 web 后台路由（书库增删改查）复用，保证与这里的存储/召回规范化逻辑不会跑偏。 */
export function normalizeTitle(title: string): string {
  return title.replace(/[《》]/g, '').trim()
}

function toRow(b: {
  id: string; title: string; author: string; theme: string | null; points: string | null; source: string
  coverUrl?: string | null; coverSource?: string | null
}): BookRow {
  return {
    id: b.id, title: b.title, author: b.author, theme: b.theme, points: b.points, source: b.source,
    coverUrl: b.coverUrl ?? null, coverSource: b.coverSource ?? null,
  }
}

/**
 * 按 (书名, 作者) 批量取已有书封。
 *
 * 作者可能缺失或与库里写法不一致（「余华」vs「余华 著」），所以**先按书名精确匹配**，
 * 作者只在有多行同名时用来消歧。宁可少命中一次多生一张图，也不能张冠李戴——
 * 给《活着》配上另一本书的封面比重新生成糟糕得多。
 */
export async function findCoversByTitles(
  books: { title: string; author?: string }[],
): Promise<Map<string, { url: string; source: string | null }>> {
  const titles = Array.from(new Set(books.map((b) => normalizeTitle(b.title)).filter(Boolean)))
  if (titles.length === 0) return new Map()
  const rows = await prisma.bookLibrary.findMany({
    where: { title: { in: titles }, coverUrl: { not: null } },
    select: { title: true, author: true, coverUrl: true, coverSource: true },
  })
  const out = new Map<string, { url: string; source: string | null }>()
  for (const b of books) {
    const t = normalizeTitle(b.title)
    const same = rows.filter((r) => r.title === t)
    if (same.length === 0) continue
    const a = (b.author ?? '').trim()
    // 多行同名时优先作者也对得上的那行；对不上就不取——见上面的注释
    const hit = same.length === 1 ? same[0] : same.find((r) => r.author === a)
    if (hit?.coverUrl) out.set(t, { url: hit.coverUrl, source: hit.coverSource })
  }
  return out
}

/** 回写书封。生图时现做的封面存回书库，下一条片子直接复用。 */
export async function setBookCover(
  title: string, author: string | undefined, coverUrl: string, coverSource: 'upload' | 'ai',
): Promise<void> {
  const t = normalizeTitle(title)
  const a = (author ?? '').trim()
  // 作者对不上时按书名更新第一行：作者写法不一致很常见，而封面只跟书走
  const where = a ? { title: t, author: a } : { title: t }
  const row = await prisma.bookLibrary.findFirst({ where, select: { id: true } })
  if (!row) return
  await prisma.bookLibrary.update({ where: { id: row.id }, data: { coverUrl, coverSource } })
}

/** 精确命中（书名 trim 后完全相同，忽略书名号）；命中返回该条，否则 null */
export async function findBookByTitle(title: string): Promise<BookRow | null> {
  const normalized = normalizeTitle(title)
  const row = await prisma.bookLibrary.findFirst({ where: { title: normalized } })
  return row ? toRow(row) : null
}

/** 按主题标签召回候选（theme 相等），最多 limit 条；theme 为空（undefined/null/''）时不查询，直接返回空数组 */
export async function findBooksByTheme(theme: string, limit: number): Promise<BookRow[]> {
  if (!theme) return []
  const rows = await prisma.bookLibrary.findMany({ where: { theme }, take: limit })
  return rows.map(toRow)
}

/** 幂等写入：同 (title, author) 已存在则返回既有行，不重复插入。
 * Prisma 的 upsert 在 PostgreSQL 上不是单条原子 SQL（BEGIN/SELECT/INSERT/SELECT/COMMIT），
 * 并发写同一 (title, author) 时后到者会撞唯一约束抛 P2002；此处捕获该错误并回查既有行返回，
 * 保证并发调用方都能拿到同一行而不是让异常冒出去。 */
export async function upsertBook(b: { title: string; author: string; theme?: string; points?: string; source?: string }): Promise<BookRow> {
  const title = normalizeTitle(b.title)
  const author = b.author.trim()
  try {
    const row = await prisma.bookLibrary.upsert({
      where: { title_author: { title, author } },
      update: {},
      create: {
        title,
        author,
        theme: b.theme ?? null,
        points: b.points ?? null,
        source: b.source ?? 'ai',
      },
    })
    return toRow(row)
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      const existing = await prisma.bookLibrary.findUnique({ where: { title_author: { title, author } } })
      if (existing) return toRow(existing)
    }
    throw err
  }
}
