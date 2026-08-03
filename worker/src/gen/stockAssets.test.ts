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
