import { describe, it, expect } from 'vitest'
import { pickAssetsForSegments, readAssetSource , poolForFolder, isCoverFolder, resolveSlotFolders } from './stockAssets'

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

// ★ 线上实测暴露的两个缺陷：
// 1. 框架的素材文件夹为空 → 查询退化成全库，挪进「·书封」的 9 张照样被正片抽中，
//    上一轮的分文件夹入库等于白做。
// 2. 逐槽位的 folder 后台能填，但生图代码从没读过它 —— 填了没用，静默失效。
describe('素材池与文件夹解析', () => {
  const A = (name: string, folder: string | null) => ({ name, folder })
  const lib = [
    A('body1', '今天分享的是'), A('body2', '今天分享的是'),
    A('cover1', '今天分享的是·书封'), A('cover2', '今天分享的是·书封'),
    A('free1', null), A('other1', '别的工程'),
  ]

  it('留空文件夹 = 全库，但**排除书封**', () => {
    const pool = poolForFolder(lib).map((a) => a.name)
    expect(pool).toEqual(['body1', 'body2', 'free1', 'other1'])
    expect(pool, '书封漏进了正片素材池').not.toContain('cover1')
  })

  it('指定文件夹时精确匹配', () => {
    expect(poolForFolder(lib, '今天分享的是').map((a) => a.name)).toEqual(['body1', 'body2'])
    expect(poolForFolder(lib, '别的工程').map((a) => a.name)).toEqual(['other1'])
  })

  // 显式点名书封文件夹时不拦——那是运营明确要的（比如想拿书封当正片配图）
  it('显式指定书封文件夹时不拦', () => {
    expect(poolForFolder(lib, '今天分享的是·书封').map((a) => a.name)).toEqual(['cover1', 'cover2'])
  })

  it('书封文件夹判定只看后缀', () => {
    expect(isCoverFolder('任意工程·书封')).toBe(true)
    expect(isCoverFolder('任意工程')).toBe(false)
    expect(isCoverFolder(null)).toBe(false)
    expect(isCoverFolder(undefined)).toBe(false)
  })

  describe('resolveSlotFolders', () => {
    it('槽位自己的 folder 优先于全局 folder', () => {
      const r = resolveSlotFolders(3, () => 'library', (i) => (i === 1 ? '专用库' : undefined), 'library', '全局库')
      expect(r).toEqual(['全局库', '专用库', '全局库'])
    })

    it('槽位显式 ai → 不走素材库（即使全局是素材库）', () => {
      const r = resolveSlotFolders(2, (i) => (i === 0 ? 'ai' : 'library'), () => undefined, 'library', '全局库')
      expect(r).toEqual([null, '全局库'])
    })

    it('槽位没配来源时跟随全局', () => {
      expect(resolveSlotFolders(2, () => undefined, () => undefined, 'ai')).toEqual([null, null])
      expect(resolveSlotFolders(2, () => undefined, () => undefined, 'library')).toEqual(['', ''])
    })
  })
})
