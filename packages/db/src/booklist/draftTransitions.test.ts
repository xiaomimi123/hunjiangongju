import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'
import { extractDraftTransitions } from './draftTransitions'

const SAMPLE = path.resolve(__dirname, '../../../../今天分享的是/draft_content.json')
const hasSample = fs.existsSync(SAMPLE)

const seg = (start: number, dur: number, refs?: string[]) => ({
  target_timerange: { start, duration: dur },
  ...(refs ? { extra_material_refs: refs } : {}),
})

describe('extractDraftTransitions', () => {
  it('畸形输入 → 空数组，不抛错', () => {
    expect(extractDraftTransitions(null)).toEqual([])
    expect(extractDraftTransitions({})).toEqual([])
    expect(extractDraftTransitions({ tracks: 'x' })).toEqual([])
  })

  it('段数 < 2 → 空数组（没有边界可言）', () => {
    const d = { tracks: [{ type: 'video', attribute: 1, segments: [seg(0, 1000)] }] }
    expect(extractDraftTransitions(d)).toEqual([])
  })

  it('转场挂在转出的那一段上：seg0 带转场 = 边界 0→1 有转场', () => {
    const d = {
      materials: { transitions: [{ id: 'T1', name: '叠化', duration: 300000 }] },
      tracks: [{ type: 'video', attribute: 1, segments: [seg(0, 1000, ['T1']), seg(1000, 1000)] }],
    }
    const out = extractDraftTransitions(d)
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ boundaryIndex: 0, sourceName: '叠化', renderType: 'crossfade', durationMs: 300, mapped: true })
  })

  it('没挂转场素材的边界 → null（硬切），不是"时长0的叠化"', () => {
    const d = {
      materials: { transitions: [] },
      tracks: [{ type: 'video', attribute: 1, segments: [seg(0, 1000), seg(1000, 1000)] }],
    }
    expect(extractDraftTransitions(d)).toEqual([null])
  })

  it('未识别的转场名 → 退化 crossfade 且 mapped:false（不静默当成叠化）', () => {
    const d = {
      materials: { transitions: [{ id: 'T9', name: '闪黑', duration: 400000 }] },
      tracks: [{ type: 'video', attribute: 1, segments: [seg(0, 1000, ['T9']), seg(1000, 1000)] }],
    }
    const out = extractDraftTransitions(d)
    expect(out[0]).toMatchObject({ sourceName: '闪黑', renderType: 'crossfade', mapped: false })
  })

  it('按时间排序而非 JSON 顺序（边界是时间概念）', () => {
    const d = {
      materials: { transitions: [{ id: 'T1', name: '叠化', duration: 300000 }] },
      tracks: [{ type: 'video', attribute: 1, segments: [seg(2000, 1000), seg(0, 1000, ['T1']), seg(1000, 1000)] }],
    }
    const out = extractDraftTransitions(d)
    // 时间序为 0/1000/2000，转场挂在最早那段上 → 边界 0 有转场，边界 1 无
    expect(out).toHaveLength(2)
    expect(out[0]).toMatchObject({ durationMs: 300 })
    expect(out[1]).toBeNull()
  })

  it.skipIf(!hasSample)('真实样例：13 个边界只有 3 个有转场，时长 300/500/500，其余全是硬切', () => {
    const draft = JSON.parse(fs.readFileSync(SAMPLE, 'utf8'))
    const out = extractDraftTransitions(draft)
    expect(out).toHaveLength(13)
    const withTrans = out.filter((x) => x !== null)
    expect(withTrans).toHaveLength(3)
    expect(withTrans.map((x) => x!.durationMs)).toEqual([300, 500, 500])
    expect(withTrans.every((x) => x!.sourceName === '叠化' && x!.mapped)).toBe(true)
    // 转场落在 seg10/11/12 上 = 边界 10/11/12
    expect(withTrans.map((x) => x!.boundaryIndex)).toEqual([10, 11, 12])
    // 快闪段（边界 0..9）全是硬切
    expect(out.slice(0, 10).every((x) => x === null)).toBe(true)
  })
})
