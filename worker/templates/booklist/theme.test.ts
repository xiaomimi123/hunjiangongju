import { describe, it, expect } from 'vitest'
import { PRESET_IDS, seedInt, selectPreset, rootVarsCss, hasGrain } from './theme'

describe('selectPreset', () => {
  it('style 精确命中预设 id 时直接采用', () => {
    expect(selectPreset('dark-premium', 'anything')).toBe('dark-premium')
    expect(selectPreset('ink-oriental', '')).toBe('ink-oriental')
  })
  it('style 缺省/非法 → 由 seed 稳定派生', () => {
    const a = selectPreset(undefined, 'task-abc')
    const b = selectPreset('not-a-preset', 'task-abc')
    expect(a).toBe(b) // 同 seed 稳定
    expect(PRESET_IDS).toContain(a)
  })
  it('不同 seed 可落到不同预设（覆盖 %3 分布）', () => {
    const got = new Set(['s0', 's1', 's2', 's3', 's4', 's5'].map((s) => selectPreset(undefined, s)))
    expect(got.size).toBeGreaterThan(1)
  })
})

describe('seedInt', () => {
  it('确定性、非负', () => {
    expect(seedInt('abc')).toBe(seedInt('abc'))
    expect(seedInt('abc')).toBeGreaterThanOrEqual(0)
  })
})

describe('rootVarsCss', () => {
  it('每套预设都产出必需的 CSS 变量', () => {
    for (const p of PRESET_IDS) {
      const css = rootVarsCss(p)
      for (const v of ['--bg', '--ink', '--ink-dim', '--accent', '--scrim', '--fs-title', '--fs-book', '--fs-cap-zh', '--fs-cap-en', '--font-title', '--font-body', '--font-en']) {
        expect(css).toContain(v)
      }
    }
  })
})

describe('hasGrain', () => {
  it('ink-oriental 开颗粒，其余关', () => {
    expect(hasGrain('ink-oriental')).toBe(true)
    expect(hasGrain('warm-literary')).toBe(false)
  })
})
