import { describe, it, expect } from 'vitest'
import { extractSubtitleEntrance } from './draftTextAnim'

function draftWith(animNames: string[]) {
  return {
    materials: {
      texts: animNames.map((_, i) => ({ id: `t${i}`, content: JSON.stringify({ text: `文字${i}` }) })),
      material_animations: animNames.map((n, i) => ({ id: `an${i}`, animations: [{ name: n, type: 'in', duration: 1_000_000 }] })),
    },
    tracks: [{ type: 'text', segments: animNames.map((_, i) => ({ material_id: `t${i}`, extra_material_refs: [`an${i}`], target_timerange: { duration: 1_000_000 } })) }],
  }
}

describe('extractSubtitleEntrance', () => {
  it('逐字放大 → char-stagger', () => { expect(extractSubtitleEntrance(draftWith(['逐字放大']))).toBe('char-stagger') })
  it('渐显 → fade-up', () => { expect(extractSubtitleEntrance(draftWith(['渐显']))).toBe('fade-up') })
  it('点开 → mask-reveal', () => { expect(extractSubtitleEntrance(draftWith(['点开']))).toBe('mask-reveal') })
  it('滑片滑动 → slide-in', () => { expect(extractSubtitleEntrance(draftWith(['滑片滑动']))).toBe('slide-in') })
  it('多个动画取出现次数最多者', () => {
    expect(extractSubtitleEntrance(draftWith(['渐显', '逐字放大', '逐字放大']))).toBe('char-stagger')
  })
  it('未知动画名/无动画 → null', () => {
    expect(extractSubtitleEntrance(draftWith(['波浪弹入']))).toBeNull()
    expect(extractSubtitleEntrance(draftWith([]))).toBeNull()
    expect(extractSubtitleEntrance(null)).toBeNull()
  })
})
