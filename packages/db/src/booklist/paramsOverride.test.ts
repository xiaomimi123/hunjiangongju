import { describe, it, expect } from 'vitest'
import { mergeTemplateParamsRaw, readTaskParamsOverride, resolveTemplateParamsRaw, TASK_PARAMS_KEY } from './paramsOverride'
import { parseTemplateParams } from './templateParams'

describe('mergeTemplateParamsRaw', () => {
  it('局部覆盖只改指定字段，同级其余字段照旧', () => {
    const base = { audio: { bgmVolume: 0.69, sfx: { openGear: true, transitionDrop: true } }, mode: 'flash' }
    const out = mergeTemplateParamsRaw(base, { audio: { bgmVolume: 0.3 } })
    expect(out).toEqual({ audio: { bgmVolume: 0.3, sfx: { openGear: true, transitionDrop: true } }, mode: 'flash' })
  })

  // ★ 数组整体替换，不逐元素合并。
  // slotDurationsMs / bodyCycle / keyframes 的元素之间是有序位关系的，
  // 逐元素合并会拼出「前几段用新的、后几段用旧的」的四不像。
  it('数组整体替换，不逐元素合并', () => {
    const out = mergeTemplateParamsRaw({ body: { slotDurationsMs: [5703, 8064, 6067] } }, { body: { slotDurationsMs: [4000, 4000] } })
    expect((out.body as Record<string, unknown>).slotDurationsMs).toEqual([4000, 4000])
  })

  it('覆盖里没写的深层字段不会被抹掉', () => {
    const base = { text: { bookTitlePosY: 0.218, bookTitleScale: 1.85, openTitlePosY: 0.811 } }
    const out = mergeTemplateParamsRaw(base, { text: { bookTitleScale: 2.2 } })
    expect(out.text).toEqual({ bookTitlePosY: 0.218, bookTitleScale: 2.2, openTitlePosY: 0.811 })
  })

  it('undefined 视为「没写」，不覆盖 base', () => {
    const out = mergeTemplateParamsRaw({ a: 1 }, { a: undefined })
    expect(out.a).toBe(1)
  })

  // 数据来自数据库 Json 列，脏了也不该让渲染整条挂掉
  it('脏数据（null / 数组 / 标量）按空对象处理，不抛错', () => {
    expect(mergeTemplateParamsRaw(null, null)).toEqual({})
    expect(mergeTemplateParamsRaw({ a: 1 }, [1, 2] as unknown)).toEqual({ a: 1 })
    expect(mergeTemplateParamsRaw('x' as unknown, { a: 1 })).toEqual({ a: 1 })
  })

  it('不修改入参', () => {
    const base = { audio: { bgmVolume: 0.69 } }
    mergeTemplateParamsRaw(base, { audio: { bgmVolume: 0.1 } })
    expect(base.audio.bgmVolume).toBe(0.69)
  })
})

describe('readTaskParamsOverride', () => {
  it('取出保留键下的对象', () => {
    expect(readTaskParamsOverride({ [TASK_PARAMS_KEY]: { audio: { bgmVolume: 0.4 } } }))
      .toEqual({ audio: { bgmVolume: 0.4 } })
  })
  it('没有 / 非对象 / variables 本身脏 → null', () => {
    expect(readTaskParamsOverride({})).toBeNull()
    expect(readTaskParamsOverride({ [TASK_PARAMS_KEY]: 'x' })).toBeNull()
    expect(readTaskParamsOverride({ [TASK_PARAMS_KEY]: [1] })).toBeNull()
    expect(readTaskParamsOverride(null)).toBeNull()
    expect(readTaskParamsOverride([1, 2])).toBeNull()
  })
})

describe('resolveTemplateParamsRaw —— 渲染侧统一入口', () => {
  const overlay = { __templateParams: { mode: 'flash', audio: { bgmVolume: 0.69 }, body: { subtitlePosY: 0.78 } }, __style: 'warm' }

  // ★ 零回归红线：没有覆盖时必须**原样返回**框架那份，
  // 不能套一层 merge 产出一个新对象——那会让老任务的渲染输入不再逐字节相同。
  it('无覆盖时原样返回框架那份（同一个引用）', () => {
    expect(resolveTemplateParamsRaw(overlay, { books: [] })).toBe(overlay.__templateParams)
    expect(resolveTemplateParamsRaw(overlay, null)).toBe(overlay.__templateParams)
  })

  it('有覆盖时合并，且不改动框架那份', () => {
    const out = resolveTemplateParamsRaw(overlay, { [TASK_PARAMS_KEY]: { audio: { bgmVolume: 0.2 } } })
    expect(parseTemplateParams(out).audio.bgmVolume).toBe(0.2)
    expect(parseTemplateParams(out).body.subtitlePosY).toBe(0.78)   // 未覆盖的照旧
    expect(overlay.__templateParams.audio.bgmVolume, '框架那份被就地改了').toBe(0.69)
  })

  it('框架没有 __templateParams、只有任务覆盖时也能生效', () => {
    const out = resolveTemplateParamsRaw({}, { [TASK_PARAMS_KEY]: { audio: { bgmVolume: 0.15 } } })
    expect(parseTemplateParams(out).audio.bgmVolume).toBe(0.15)
  })

  it('overlayTemplate 为 null / 脏数据 → 不抛错，落到默认值', () => {
    expect(parseTemplateParams(resolveTemplateParamsRaw(null, null)).audio.bgmVolume).toBe(0.69)
    expect(parseTemplateParams(resolveTemplateParamsRaw('x', null)).mode).toBe('classic')
  })
})
