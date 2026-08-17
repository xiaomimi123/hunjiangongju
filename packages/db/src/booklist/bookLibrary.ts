// 本地可运营维护的书库：AI 选书结果 / 人工审校后的 书名+作者 沉淀于此，供后续复用与召回。
import { prisma } from '../client'

export interface BookRow {
  id: string
  title: string
  author: string
  theme: string | null
  points: string | null
  source: string
}

/** 规范化书名：去掉书名号《》与首尾空白，用于统一存储与查询。 */
function normalizeTitle(title: string): string {
  return title.replace(/[《》]/g, '').trim()
}

function toRow(b: { id: string; title: string; author: string; theme: string | null; points: string | null; source: string }): BookRow {
  return { id: b.id, title: b.title, author: b.author, theme: b.theme, points: b.points, source: b.source }
}

/** 精确命中（书名 trim 后完全相同，忽略书名号）；命中返回该条，否则 null */
export async function findBookByTitle(title: string): Promise<BookRow | null> {
  const normalized = normalizeTitle(title)
  const row = await prisma.bookLibrary.findFirst({ where: { title: normalized } })
  return row ? toRow(row) : null
}

/** 按主题标签召回候选（theme 相等），最多 limit 条 */
export async function findBooksByTheme(theme: string, limit: number): Promise<BookRow[]> {
  const rows = await prisma.bookLibrary.findMany({ where: { theme }, take: limit })
  return rows.map(toRow)
}

/** 幂等写入：同 (title, author) 已存在则返回既有行，不重复插入 */
export async function upsertBook(b: { title: string; author: string; theme?: string; points?: string; source?: string }): Promise<BookRow> {
  const title = normalizeTitle(b.title)
  const author = b.author.trim()
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
}
