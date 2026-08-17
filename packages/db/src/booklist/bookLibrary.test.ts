import { describe, it, expect, afterAll } from 'vitest'
import { findBookByTitle, findBooksByTheme, upsertBook } from './bookLibrary'
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
