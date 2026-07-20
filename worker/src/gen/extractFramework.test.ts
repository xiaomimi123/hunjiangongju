import { describe, it, expect } from 'vitest'
import { extractBooks } from './extractFramework'

describe('extractBooks（纯正则，无 LLM/DB）', () => {
  it('识别单本书名+作者（书名后紧跟"作者/著"标记）', () => {
    const transcript = '今天给大家推荐一本书，《活下去的理由》马特·海格/著，写得非常真诚。'
    expect(extractBooks(transcript)).toEqual([{ title: '活下去的理由', author: '马特·海格' }])
  })

  it('识别"作者："标记形式', () => {
    const transcript = '《百年孤独》作者：加西亚·马尔克斯，是魔幻现实主义代表作。'
    expect(extractBooks(transcript)).toEqual([{ title: '百年孤独', author: '加西亚·马尔克斯' }])
  })

  it('多本书按出现顺序去重返回', () => {
    const transcript =
      '第一本是《活下去的理由》马特·海格/著。' +
      '第二本也很棒，《活下去的理由》马特·海格/著，再提一次这本书。' +
      '最后推荐《百年孤独》作者：加西亚·马尔克斯。'
    expect(extractBooks(transcript)).toEqual([
      { title: '活下去的理由', author: '马特·海格' },
      { title: '百年孤独', author: '加西亚·马尔克斯' },
    ])
  })

  it('无书名号时返回空数组', () => {
    const transcript = '这是一段没有提到任何书名的口播文案，纯粹分享个人经历。'
    expect(extractBooks(transcript)).toEqual([])
  })

  it('书名号存在但附近找不到作者标记时，author 缺省为 undefined', () => {
    const transcript = '大家一定要看看《活下去的理由》，真的会改变你的想法。'
    expect(extractBooks(transcript)).toEqual([{ title: '活下去的理由' }])
  })
})
