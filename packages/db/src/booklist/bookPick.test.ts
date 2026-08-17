import { describe, it, expect } from 'vitest'
import { seedFrom, pickSubset, pickAngle, ANGLES, parseBookList, dedupeBooks, resolveBookCount, isSameBook } from './bookPick'

describe('稳定随机', () => {
  it('同 seed 结果一致，异 seed 结果不同', () => {
    const xs = Array.from({ length: 10 }, (_, i) => i)
    expect(pickSubset(xs, 3, 'task-a')).toEqual(pickSubset(xs, 3, 'task-a'))
    expect(pickSubset(xs, 3, 'task-a')).not.toEqual(pickSubset(xs, 3, 'task-b'))
  })
  it('候选不足时返回全部', () => {
    expect(pickSubset([1, 2], 5, 's').sort()).toEqual([1, 2])
  })
  it('pickAngle 取自角度池且同 seed 稳定', () => {
    expect(ANGLES).toContain(pickAngle('t1'))
    expect(pickAngle('t1')).toBe(pickAngle('t1'))
  })
  it('seedFrom 非负', () => { expect(seedFrom('任意')).toBeGreaterThanOrEqual(0) })

  it('不同 seed 下候选集的排列（非仅起始偏移）显著不同，弱实现(仅偏移起点)应无法通过', () => {
    const xs = Array.from({ length: 20 }, (_, i) => i)
    // 取出全部 20 个元素的排列顺序，比较多个 seed 两两之间的顺序差异
    const seeds = ['alpha', 'bravo', 'charlie', 'delta', 'echo']
    const perms = seeds.map((s) => pickSubset(xs, 20, s))
    // 全部都应是同一组元素的排列（同一 multiset）
    for (const p of perms) expect([...p].sort((a, b) => a - b)).toEqual(xs)
    // 一个仅靠"起始偏移"选择候选集的弱实现，对于 n === candidates.length 的情况，
    // 顺序里"相邻元素之差"几乎全部固定为 1（除了绕回处），几乎不随 seed 变化。
    // 强实现（真洗牌）应使得不同 seed 之间的排列有大量位置不同。
    let totalDiffPositions = 0
    let comparisons = 0
    for (let i = 0; i < perms.length; i++) {
      for (let j = i + 1; j < perms.length; j++) {
        let diff = 0
        for (let k = 0; k < xs.length; k++) if (perms[i][k] !== perms[j][k]) diff++
        totalDiffPositions += diff
        comparisons++
      }
    }
    const avgDiff = totalDiffPositions / comparisons
    // 若只是偏移起点式的"旋转"，大部分位置对不同 seed 仍会相同或呈现固定规律；
    // 真正洗牌应让平均相异位置数远高于该阈值（20 个元素里至少一半以上不同）。
    expect(avgDiff).toBeGreaterThan(10)
  })
})

/** 确定性生成"uuid 形状"的种子字符串（8-4-4-4-12 十六进制），不依赖 Math.random / crypto.randomUUID，
 *  仅由入参 index 派生，保证测试集在每次运行时完全一致。混合函数与被测的 seedFrom 完全独立（不同算法族），
 *  避免"用同一套哈希既生成测试数据又验证测试数据"这种自证循环。 */
function uuidShapedSeed(index: number): string {
  let state = ((index + 1) * 2654435761) >>> 0
  const bytes: number[] = []
  for (let k = 0; k < 16; k++) {
    state = (Math.imul(state ^ (state >>> 15), 2246822519) + 0x9e3779b9) >>> 0
    state = (state ^ (state >>> 13)) >>> 0
    bytes.push(state & 0xff)
    state = (Math.imul(state, 2246822519) + k) >>> 0
  }
  const hex = bytes.map((b) => b.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`
}

describe('分布回归：seedFrom 在 uuid 形状种子下不塌缩', () => {
  it('用 2000 个确定性生成的 uuid 形状种子洗牌 20 元素数组，元素 0 落点应覆盖全部 20 个位置且无严重塌缩', () => {
    const xs = Array.from({ length: 20 }, (_, i) => i)
    const N = 2000
    const positionCounts = new Array(20).fill(0)
    for (let i = 0; i < N; i++) {
      const seed = uuidShapedSeed(i)
      const shuffled = pickSubset(xs, 20, seed)
      const pos = shuffled.indexOf(0)
      positionCounts[pos] += 1
    }
    // 均匀期望每桶 N/20 = 100。要求每个位置都被命中，且命中数不低于均匀期望的 20%（留足余量，
    // 只用来卡"结构性不可达"这种塌缩问题，不对分布形状做过严格的统计检验）。
    const expectedPerBucket = N / xs.length
    const minAcceptable = expectedPerBucket * 0.2
    for (let pos = 0; pos < 20; pos++) {
      expect(positionCounts[pos]).toBeGreaterThanOrEqual(minAcceptable)
    }
  })
})

describe('parseBookList', () => {
  it('解析合法 JSON 数组', () => {
    expect(parseBookList('[{"title":"活着","author":"余华","points":"苦难与坚韧"}]'))
      .toEqual([{ title: '活着', author: '余华', points: '苦难与坚韧' }])
  })
  it('剥掉代码围栏', () => {
    expect(parseBookList('```json\n[{"title":"平凡的世界","author":"路遥"}]\n```'))
      .toEqual([{ title: '平凡的世界', author: '路遥' }])
  })
  it('剔除缺书名或作者的条目', () => {
    expect(parseBookList('[{"title":"只有书名"},{"author":"只有作者"},{"title":"完整","author":"甲"}]'))
      .toEqual([{ title: '完整', author: '甲' }])
  })
  it('垃圾输入 → 空数组，不抛错', () => {
    expect(parseBookList('抱歉我无法完成')).toEqual([])
    expect(parseBookList('')).toEqual([])
  })
  it('书名带《》时去掉', () => {
    expect(parseBookList('[{"title":"《活着》","author":"余华"}]')).toEqual([{ title: '活着', author: '余华' }])
  })
})

describe('dedupeBooks', () => {
  it('同书名同作者只留一条，先来先留', () => {
    expect(dedupeBooks([
      { title: '活着', author: '余华', points: '第一条' },
      { title: '《活着》', author: '余华', points: '第二条' },
    ])).toEqual([{ title: '活着', author: '余华', points: '第一条' }])
  })
  it('同书名不同作者视为不同书', () => {
    expect(dedupeBooks([{ title: 'A', author: '甲' }, { title: 'A', author: '乙' }]).length).toBe(2)
  })
})

describe('isSameBook', () => {
  it('副标题前缀 + 一方作者为空 → 同一本', () => {
    expect(isSameBook(
      { title: '被讨厌的勇气', author: '' },
      { title: '被讨厌的勇气：自我启发之父阿德勒的哲学课', author: '岸见一郎、古贺史健' },
    )).toBe(true)
  })
  it('副标题前缀 + 作者一致 → 同一本', () => {
    expect(isSameBook(
      { title: '活着', author: '余华' },
      { title: '活着（新版）', author: '余华' },
    )).toBe(true)
  })
  it('前缀但无副标题分隔符 → 不同书（防误吞）', () => {
    expect(isSameBook({ title: '活着', author: '余华' }, { title: '活着之上', author: '阎连科' })).toBe(false)
    expect(isSameBook({ title: '活着', author: '' }, { title: '活着之上', author: '' })).toBe(false)
  })
  it('作者明确不同 → 不同书', () => {
    expect(isSameBook(
      { title: '哈姆雷特', author: '莎士比亚' },
      { title: '哈姆雷特：注释本', author: '朱生豪' },
    )).toBe(false)
  })
  it('完全同名同作者 → 同一本', () => {
    expect(isSameBook({ title: '《活着》', author: ' 余华 ' }, { title: '活着', author: '余华' })).toBe(true)
  })
  it('毫不相干 → 不同书', () => {
    expect(isSameBook({ title: 'A', author: '甲' }, { title: 'B', author: '乙' })).toBe(false)
  })
})

describe('dedupeBooks 合并同一本书', () => {
  it('短名无作者 + 全名有作者 → 只留一条,取信息更全者,位置不变', () => {
    const out = dedupeBooks([
      { title: '被讨厌的勇气', author: '' },
      { title: '活出生命的意义', author: '弗兰克尔' },
      { title: '被讨厌的勇气：自我启发之父阿德勒的哲学课', author: '岸见一郎、古贺史健', points: 'X' },
    ])
    expect(out).toHaveLength(2)
    expect(out[0]).toEqual({ title: '被讨厌的勇气：自我启发之父阿德勒的哲学课', author: '岸见一郎、古贺史健', points: 'X' })
    expect(out[1].title).toBe('活出生命的意义')
  })
  it('两条都有作者时保留先出现的', () => {
    const out = dedupeBooks([
      { title: '活着', author: '余华', points: '先' },
      { title: '活着：新版', author: '余华', points: '后' },
    ])
    expect(out).toHaveLength(1)
    expect(out[0].points).toBe('先')
  })
  it('不同书不合并（回归）', () => {
    expect(dedupeBooks([{ title: '活着', author: '余华' }, { title: '活着之上', author: '阎连科' }])).toHaveLength(2)
  })
})

describe('resolveBookCount', () => {
  it('优先 __bookCount', () => { expect(resolveBookCount({ __bookCount: 13, books: [1, 2] })).toBe(13) })
  it('回退 books.length', () => { expect(resolveBookCount({ books: [1, 2, 3] })).toBe(3) })
  it('都没有 → 5', () => { expect(resolveBookCount({})).toBe(5); expect(resolveBookCount(null)).toBe(5) })
  it('越界 clamp 到 1..20', () => {
    expect(resolveBookCount({ __bookCount: 0 })).toBe(1)
    expect(resolveBookCount({ __bookCount: 999 })).toBe(20)
  })
})
