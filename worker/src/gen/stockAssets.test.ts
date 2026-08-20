import { describe, it, expect } from 'vitest'
import { pickAssetsForSegments, readAssetSource } from './stockAssets'

describe('pickAssetsForSegments', () => {
  it('素材多于分镜:前 N 个按序分配', () => {
    expect(pickAssetsForSegments(['a', 'b', 'c'], 2)).toEqual(['a', 'b'])
  })
  it('素材少于分镜:不足补 null 不循环', () => {
    expect(pickAssetsForSegments(['a'], 3)).toEqual(['a', null, null])
  })
  it('空素材:全 null', () => {
    expect(pickAssetsForSegments([], 2)).toEqual([null, null])
  })
  it('素材数量恰好等于分镜数:原样按序分配', () => {
    expect(pickAssetsForSegments(['a', 'b'], 2)).toEqual(['a', 'b'])
  })
  it('分镜数为 0:空数组', () => {
    expect(pickAssetsForSegments(['a', 'b'], 0)).toEqual([])
  })
})

describe('readAssetSource', () => {
  it('assetSource=library 且带 assetFolder:透传 source+folder', () => {
    expect(readAssetSource({ assetSource: 'library', assetFolder: '旅行' })).toEqual({ source: 'library', folder: '旅行' })
  })
  it('assetSource=library 但 assetFolder 为空/缺省:source=library 无 folder', () => {
    expect(readAssetSource({ assetSource: 'library' })).toEqual({ source: 'library' })
    expect(readAssetSource({ assetSource: 'library', assetFolder: '   ' })).toEqual({ source: 'library' })
  })
  it('缺省 variables:默认 ai', () => {
    expect(readAssetSource(undefined)).toEqual({ source: 'ai' })
    expect(readAssetSource(null)).toEqual({ source: 'ai' })
    expect(readAssetSource({})).toEqual({ source: 'ai' })
  })
  it('非法 assetSource 值:回退 ai', () => {
    expect(readAssetSource({ assetSource: 'bogus' })).toEqual({ source: 'ai' })
    expect(readAssetSource({ assetSource: 123 })).toEqual({ source: 'ai' })
  })
  it('非对象 variables:回退 ai', () => {
    expect(readAssetSource('library')).toEqual({ source: 'ai' })
    expect(readAssetSource(42)).toEqual({ source: 'ai' })
  })
})

// 批量场景：一天几千条片子共用一个素材库。原实现「按顺序取前 N 张」会让每条片子
// 都拿到同样那几张图——库里存 500 张也没用。改为按 genTaskId 派生的确定性随机抽取。
describe('pickAssetsForSegments —— 确定性随机抽取', () => {
  const assets = Array.from({ length: 20 }, (_, i) => `a${i + 1}`)

  it('同一 seed 结果稳定（同任务重跑一致）', () => {
    expect(pickAssetsForSegments(assets, 4, 'task-a')).toEqual(pickAssetsForSegments(assets, 4, 'task-a'))
  })

  it('不同 seed 结果不同（不同片子不撞图）', () => {
    expect(pickAssetsForSegments(assets, 4, 'task-a')).not.toEqual(pickAssetsForSegments(assets, 4, 'task-b'))
  })

  it('库存充足时同一条片子内不重复', () => {
    const out = pickAssetsForSegments(assets, 5, 'task-a')
    expect(new Set(out).size).toBe(5)
  })

  it('库存不足 → 循环复用而非留 null（留 null 会回退 AI 生图，正是要消灭的）', () => {
    const few = ['x', 'y']
    const out = pickAssetsForSegments(few, 5, 'task-a')
    expect(out).toHaveLength(5)
    expect(out.every((x) => x !== null)).toBe(true)
    expect(new Set(out)).toEqual(new Set(few))
  })

  it('素材库为空 → 全 null（此时确实该回退 AI 生图）', () => {
    expect(pickAssetsForSegments([], 3, 'task-a')).toEqual([null, null, null])
  })

  it('不传 seed → 维持原「按顺序取」行为（老调用点零回归）', () => {
    expect(pickAssetsForSegments(assets, 3)).toEqual(['a1', 'a2', 'a3'])
    expect(pickAssetsForSegments(['x'], 3)).toEqual(['x', null, null])
  })
})
