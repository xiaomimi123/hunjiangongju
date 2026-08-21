import { describe, it, expect, afterAll, beforeAll } from 'vitest'
import { findBookByTitle, findBooksByTheme, upsertBook , findCoversByTitles, setBookCover } from './bookLibrary'
import { prisma } from '../client'

const ids: string[] = []
afterAll(async () => { await prisma.bookLibrary.deleteMany({ where: { id: { in: ids } } }) })

describe('bookLibrary', () => {
  it('upsert 幂等：同书名+作者第二次返回既有行', async () => {
    const a = await upsertBook({ title: '被讨厌的勇气', author: '岸见一郎', theme: '心理' }); ids.push(a.id)
    const b = await upsertBook({ title: '被讨厌的勇气', author: '岸见一郎', theme: '心理' })
    expect(b.id).toBe(a.id)
    expect(await prisma.bookLibrary.count({ where: { title: '被讨厌的勇气', author: '岸见一郎' } })).toBe(1)
  })
  it('findBookByTitle 忽略书名号与首尾空白', async () => {
    const a = await upsertBook({ title: '活着', author: '余华' }); ids.push(a.id)
    expect((await findBookByTitle(' 《活着》 '))?.id).toBe(a.id)
  })
  it('findBookByTitle 未命中 → null', async () => {
    expect(await findBookByTitle('不存在的书名XYZ')).toBeNull()
  })
  it('findBooksByTheme 按主题召回并受 limit 限制', async () => {
    for (const t of ['主题书A', '主题书B', '主题书C']) {
      const r = await upsertBook({ title: t, author: '作者X', theme: '测试主题' }); ids.push(r.id)
    }
    expect((await findBooksByTheme('测试主题', 2)).length).toBe(2)
  })
  it('findBooksByTheme theme 为空（undefined/null/空串）→ 不返回无关书目，直接空数组', async () => {
    expect(await findBooksByTheme(undefined as unknown as string, 5)).toEqual([])
    expect(await findBooksByTheme(null as unknown as string, 5)).toEqual([])
    expect(await findBooksByTheme('', 5)).toEqual([])
  })
  it('upsertBook 并发安全：同 (title, author) 并发写入只落一行', async () => {
    // 先并发打一批 pg_sleep 请求，逼连接池真的开出多条物理连接（否则冷启动时单条连接会把
    // 隐式事务串行化，并发调用在同一条连接上排队执行，永远撞不上竞态窗口，测试会假阴性）。
    await Promise.all(
      Array.from({ length: 30 }, () => prisma.$queryRawUnsafe('SELECT pg_sleep(0.08)::text'))
    )

    const book = { title: '并发测试书', author: '并发作者', theme: '并发' }
    // 用 allSettled 而非 Promise.all：修复前这里必然会有调用因撞唯一约束而 reject，
    // 用 allSettled 观察全部 20 个调用的真实结果，而不是被 Promise.all 的短路行为掩盖。
    const settled = await Promise.allSettled(Array.from({ length: 20 }, () => upsertBook(book)))
    const fulfilled = settled.filter(
      (r): r is PromiseFulfilledResult<Awaited<ReturnType<typeof upsertBook>>> => r.status === 'fulfilled'
    )
    for (const r of fulfilled) ids.push(r.value.id)

    expect(settled.every((r) => r.status === 'fulfilled')).toBe(true)
    const firstId = fulfilled[0]?.value.id
    expect(fulfilled.every((r) => r.value.id === firstId)).toBe(true)
    expect(
      await prisma.bookLibrary.count({ where: { title: book.title, author: book.author } })
    ).toBe(1)
  })
})

// ★ 书封只跟「这本书」有关，跟这条片子的文案毫无关系。
// 原先每条片子都为每本书重生成一张——9 本书就是 9 次生图调用，
// 而其中绝大多数是同样那几本常见书。存进书库后一次做完、永久复用。
describe('书封复用', () => {
  const mk = (title: string, author: string, coverUrl: string | null) =>
    prisma.bookLibrary.create({ data: { title, author, coverUrl, ...(coverUrl ? { coverSource: 'ai' } : {}) } })

  beforeAll(async () => {
    await prisma.bookLibrary.deleteMany({ where: { title: { startsWith: '封面测试' } } })
    await mk('封面测试A', '甲', '/api/files/covers/a.png')
    await mk('封面测试B', '乙', null)
    await mk('封面测试C', '丙一', '/api/files/covers/c1.png')
    await mk('封面测试C', '丙二', '/api/files/covers/c2.png')
  })
  afterAll(async () => {
    await prisma.bookLibrary.deleteMany({ where: { title: { startsWith: '封面测试' } } })
  })

  it('有封面的取到，没封面的不出现在结果里', async () => {
    const m = await findCoversByTitles([{ title: '封面测试A' }, { title: '封面测试B' }])
    expect(m.get('封面测试A')?.url).toBe('/api/files/covers/a.png')
    expect(m.has('封面测试B'), '没有封面的书不该出现').toBe(false)
  })

  it('书名带《》也能命中（与入库时同一套规范化）', async () => {
    const m = await findCoversByTitles([{ title: '《封面测试A》' }])
    expect(m.get('封面测试A')?.url).toBe('/api/files/covers/a.png')
  })

  // ★ 同名不同作者时必须靠作者消歧。张冠李戴地给《活着》配上另一本书的封面，
  // 比重新生成一张糟糕得多——所以对不上就宁可不取。
  it('同名多本时按作者消歧', async () => {
    const m1 = await findCoversByTitles([{ title: '封面测试C', author: '丙二' }])
    expect(m1.get('封面测试C')?.url).toBe('/api/files/covers/c2.png')
    const m2 = await findCoversByTitles([{ title: '封面测试C', author: '查无此人' }])
    expect(m2.has('封面测试C'), '作者对不上时宁可不取，也不能配错封面').toBe(false)
  })

  it('回写后能被取到', async () => {
    await setBookCover('封面测试B', '乙', '/api/files/covers/b.png', 'ai')
    const m = await findCoversByTitles([{ title: '封面测试B', author: '乙' }])
    expect(m.get('封面测试B')).toEqual({ url: '/api/files/covers/b.png', source: 'ai' })
  })

  it('书目不存在时回写不抛错（生图流程不该因此中断）', async () => {
    await expect(setBookCover('查无此书', '某某', '/x.png', 'ai')).resolves.toBeUndefined()
  })
})
