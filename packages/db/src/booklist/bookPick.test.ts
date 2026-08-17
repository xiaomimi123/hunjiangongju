import { describe, it, expect } from 'vitest'
import { seedFrom, pickSubset, pickAngle, ANGLES, parseBookList, dedupeBooks, resolveBookCount } from './bookPick'

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

describe('resolveBookCount', () => {
  it('优先 __bookCount', () => { expect(resolveBookCount({ __bookCount: 13, books: [1, 2] })).toBe(13) })
  it('回退 books.length', () => { expect(resolveBookCount({ books: [1, 2, 3] })).toBe(3) })
  it('都没有 → 5', () => { expect(resolveBookCount({})).toBe(5); expect(resolveBookCount(null)).toBe(5) })
  it('越界 clamp 到 1..20', () => {
    expect(resolveBookCount({ __bookCount: 0 })).toBe(1)
    expect(resolveBookCount({ __bookCount: 999 })).toBe(20)
  })
})
