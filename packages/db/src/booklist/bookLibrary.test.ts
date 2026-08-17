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
})
