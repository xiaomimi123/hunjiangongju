import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'
import { extractDraftEffects, deriveRipple } from './draftEffects'

const SAMPLE = path.resolve(__dirname, '../../../../今天分享的是/draft_content.json')

describe('extractDraftEffects', () => {
  it('无 effect 轨 / 无 video_effects → 空数组，不抛错', () => {
    expect(extractDraftEffects(null)).toEqual([])
    expect(extractDraftEffects({})).toEqual([])
    expect(extractDraftEffects({ tracks: [{ type: 'effect', segments: [{}] }] })).toEqual([])
  })

  it('段引用不到素材 / 时长为 0 → 丢弃', () => {
    const draft = {
      materials: { video_effects: [{ id: 'e1', name: '水波纹' }] },
      tracks: [{ type: 'effect', segments: [
        { material_id: 'nope', target_timerange: { start: 0, duration: 1000000 } },
        { material_id: 'e1', target_timerange: { start: 0, duration: 0 } },
      ] }],
    }
    expect(extractDraftEffects(draft)).toEqual([])
  })

  it('未在映射表中的特效名 → renderType 为 null（如实报告未复刻，不套别的效果）', () => {
    const draft = {
      materials: { video_effects: [{ id: 'e1', name: '某个没见过的特效' }] },
      tracks: [{ type: 'effect', segments: [{ material_id: 'e1', target_timerange: { start: 0, duration: 500000 } }] }],
    }
    expect(extractDraftEffects(draft)[0]).toMatchObject({ sourceName: '某个没见过的特效', renderType: null })
  })
})

describe('extractDraftEffects —— 客户样例实测值', () => {
  const raw = fs.existsSync(SAMPLE) ? JSON.parse(fs.readFileSync(SAMPLE, 'utf8')) : null
  const t = raw ? it : it.skip

  t('样例含且仅含 1 条水波纹，3991ms 起、458ms 长', () => {
    const out = extractDraftEffects(raw)
    expect(out).toHaveLength(1)
    expect(out[0]).toEqual({ sourceName: '水波纹', renderType: 'ripple', startMs: 3991, durationMs: 458 })
  })

  t('相对快闪结束(3984ms)的偏移是 +7ms —— 水波纹就压在那一刀上', () => {
    expect(deriveRipple(extractDraftEffects(raw), 3984)).toEqual({ offsetMs: 7, durationMs: 458 })
  })
})

describe('deriveRipple', () => {
  const eff = [{ sourceName: '水波纹', renderType: 'ripple' as const, startMs: 3991, durationMs: 458 }]

  it('无水波纹 → null', () => {
    expect(deriveRipple([], 3984)).toBeNull()
    expect(deriveRipple([{ sourceName: 'x', renderType: null, startMs: 0, durationMs: 100 }], 3984)).toBeNull()
  })

  it('flashEnd 非法 → null', () => {
    expect(deriveRipple(eff, NaN)).toBeNull()
  })

  // 离刀口太远说明它是条独立特效，硬按到刀口上等于把它挪到创作者没打算放的位置
  it('偏移超出阈值 → null，不硬按到刀口上', () => {
    expect(deriveRipple(eff, 0)).toBeNull()            // 偏移 +3991ms
    expect(deriveRipple(eff, 3991 + 1600)).toBeNull()  // 偏移 -1600ms
    expect(deriveRipple(eff, 3991 - 1400)).not.toBeNull()
  })
})
