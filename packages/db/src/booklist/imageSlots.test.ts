import { describe, it, expect } from 'vitest'
import { readImageSlots, slotAt , readOpenImage } from './imageSlots'

describe('readImageSlots', () => {
  it('未配置 → null（调用方维持现状）', () => {
    expect(readImageSlots(null)).toBeNull()
    expect(readImageSlots({})).toBeNull()
    expect(readImageSlots({ __imageSlots: {} })).toBeNull()
    expect(readImageSlots({ __imageSlots: { count: 0 } })).toBeNull()
    expect(readImageSlots({ __imageSlots: { count: -1 } })).toBeNull()
  })

  it('正常配置 → 解析出槽位', () => {
    const cfg = readImageSlots({
      __imageSlots: {
        count: 4,
        slots: [
          { index: 0, source: 'ai', prompt: '一只猫' },
          { index: 3, source: 'library', folder: '梵高' },
        ],
      },
    })
    expect(cfg!.count).toBe(4)
    expect(cfg!.slots).toHaveLength(2)
    expect(slotAt(cfg, 0)).toMatchObject({ source: 'ai', prompt: '一只猫' })
    expect(slotAt(cfg, 3)).toMatchObject({ source: 'library', folder: '梵高' })
    expect(slotAt(cfg, 1)).toBeUndefined()
  })

  it('脏项静默丢弃，不影响其余槽位（运营可能手改 JSON）', () => {
    const cfg = readImageSlots({
      __imageSlots: {
        count: 3,
        slots: [
          { index: 0, source: 'ai' },
          { index: 99, source: 'ai' },        // 越界
          { index: 1, source: '乱写' },        // 非法来源
          { index: 'x', source: 'ai' },        // 非法下标
          { index: 2, source: 'library' },
        ],
      },
    })
    expect(cfg!.slots.map((s) => s.index)).toEqual([0, 2])
  })

  it('空白 prompt/folder 视为未填', () => {
    const cfg = readImageSlots({
      __imageSlots: { count: 2, slots: [{ index: 0, source: 'ai', prompt: '   ', folder: '' }] },
    })
    expect(slotAt(cfg, 0)).toEqual({ index: 0, source: 'ai' })
  })

  it('slots 缺失或非数组 → count 仍生效（用于只锁段数、不配来源）', () => {
    expect(readImageSlots({ __imageSlots: { count: 4 } })).toEqual({ count: 4, slots: [] })
    expect(readImageSlots({ __imageSlots: { count: 4, slots: 'x' } })).toEqual({ count: 4, slots: [] })
  })
})

// 画风原本只有框架级一个全局值,做不到「第 1 张卡通头像、后面达芬奇」。
// 逐槽 style 覆盖框架画风;留空仍走全局,老框架零回归。
describe('逐槽画风覆盖', () => {
  it('解析 style;空白视为未配置', () => {
    const cfg = readImageSlots({
      __imageSlots: {
        count: 3,
        slots: [
          { index: 0, source: 'ai', style: '日系卡通头像,人物特写' },
          { index: 1, source: 'ai', style: '   ' },
          { index: 2, source: 'ai' },
        ],
      },
    })
    expect(slotAt(cfg, 0)?.style).toBe('日系卡通头像,人物特写')
    expect(slotAt(cfg, 1)?.style).toBeUndefined()
    expect(slotAt(cfg, 2)?.style).toBeUndefined()
  })
})

// ★ 开场图必须有自己的槽位。之前渲染层直接取正片第 1 张当开场底图，
// 于是「开场卡通人物头像」和「正片艺术画风」二选一——把第 1 槽配成头像，
// 正片第一段也会变成那张头像。草稿里开场本来就是独立素材。
describe('readOpenImage', () => {
  it('读出开场图的主体与画风', () => {
    expect(readOpenImage({ __openImage: { prompt: '少年侧脸', style: '日系动漫画风,男性少年面部特写' } }))
      .toEqual({ prompt: '少年侧脸', style: '日系动漫画风,男性少年面部特写' })
  })

  it('只填其一也算配了', () => {
    expect(readOpenImage({ __openImage: { style: '达芬奇油画' } })).toEqual({ style: '达芬奇油画' })
    expect(readOpenImage({ __openImage: { prompt: '人物特写' } })).toEqual({ prompt: '人物特写' })
  })

  // 没配 → null，渲染层回退正片第 1 张。这是老框架的零回归保证。
  it('未配置/空对象/空串 → null（渲染层回退正片第 1 张）', () => {
    expect(readOpenImage(null)).toBeNull()
    expect(readOpenImage({})).toBeNull()
    expect(readOpenImage({ __openImage: {} })).toBeNull()
    expect(readOpenImage({ __openImage: { prompt: '   ', style: '' } })).toBeNull()
    expect(readOpenImage({ __openImage: 'x' })).toBeNull()
  })
})
