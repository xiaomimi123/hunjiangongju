import { describe, it, expect } from 'vitest'
import { readImageSlots, slotAt } from './imageSlots'

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
