import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'
import { detectUnsupported, buildFidelityReport, isFidelityReport } from './draftProvenance'

const SAMPLE = path.resolve(__dirname, '../../../../今天分享的是/draft_content.json')
const hasSample = fs.existsSync(SAMPLE)

describe('detectUnsupported —— 只报草稿里真实存在的不可复刻项', () => {
  it('空/畸形输入 → 空数组，不抛错', () => {
    expect(detectUnsupported(null)).toEqual([])
    expect(detectUnsupported({})).toEqual([])
    expect(detectUnsupported('not an object')).toEqual([])
    expect(detectUnsupported({ materials: null, tracks: 'x' })).toEqual([])
  })

  it('草稿没有特效轨/特效素材 → 不报（避免噪音）', () => {
    const paths = detectUnsupported({ materials: { video_effects: [], effects: [] }, tracks: [] }).map((e) => e.path)
    expect(paths).not.toContain('effectTrack')
    expect(paths).not.toContain('videoEffects')
  })

  it('有独立特效轨 → 报 effectTrack', () => {
    const d = { materials: {}, tracks: [{ type: 'effect', segments: [{}] }] }
    expect(detectUnsupported(d).map((e) => e.path)).toContain('effectTrack')
  })

  it('有 bloom 外发光 → 报 textGlow，且 detail 含条数', () => {
    const d = { materials: { effects: [{ type: 'bloom' }, { type: 'bloom' }, { type: 'filter' }] }, tracks: [] }
    const e = detectUnsupported(d).find((x) => x.path === 'textGlow')
    expect(e).toBeTruthy()
    expect(e!.detail).toContain('2')
  })

  it('转场时长只有一种 → 不报差异；有多种 → 报', () => {
    const one = { materials: { transitions: [{ duration: 500000 }, { duration: 500000 }] }, tracks: [] }
    expect(detectUnsupported(one).map((e) => e.path)).not.toContain('transition.perBoundary')
    const two = { materials: { transitions: [{ duration: 300000 }, { duration: 500000 }] }, tracks: [] }
    expect(detectUnsupported(two).map((e) => e.path)).toContain('transition.perBoundary')
  })

  it('踩点只有阈值、无真实时间戳 → 不报（样例即如此）', () => {
    const d = { materials: { beats: [{ type: 'beats', ai_beats: { melody_percents: [0.6] } }] }, tracks: [] }
    expect(detectUnsupported(d).map((e) => e.path)).not.toContain('beats')
  })

  it('所有条目 status 恒为 unsupported', () => {
    const d = { materials: { effects: [{ type: 'bloom' }] }, tracks: [{ type: 'effect', segments: [{}] }] }
    expect(detectUnsupported(d).every((e) => e.status === 'unsupported')).toBe(true)
  })
})

describe('detectUnsupported —— 真实样例', () => {
  it.skipIf(!hasSample)('检出特效轨/画面特效/外发光×11/视频素材段/转场时长两种，且不报踩点', () => {
    const draft = JSON.parse(fs.readFileSync(SAMPLE, 'utf8'))
    const paths = detectUnsupported(draft).map((e) => e.path)
    expect(paths).toContain('effectTrack')
    expect(paths).toContain('videoEffects')
    expect(paths).toContain('textGlow')
    expect(paths).toContain('videoSegment')
    expect(paths).toContain('transition.perBoundary')
    expect(paths).not.toContain('beats')
    const glow = detectUnsupported(draft).find((e) => e.path === 'textGlow')!
    expect(glow.detail).toContain('11')
  })
})

describe('buildFidelityReport / isFidelityReport', () => {
  it('summary 计数与 entries 一致', () => {
    const r = buildFidelityReport(
      [
        { path: 'a', status: 'extracted' },
        { path: 'b', status: 'defaulted' },
        { path: 'c', status: 'unsupported' },
        { path: 'd', status: 'extracted' },
      ],
      '2026-08-19T00:00:00.000Z',
    )
    expect(r.summary).toEqual({ extracted: 2, defaulted: 1, unsupported: 1 })
    expect(r.entries).toHaveLength(4)
    expect(r.parsedAt).toBe('2026-08-19T00:00:00.000Z')
  })

  it('isFidelityReport 认得合法结构、拒绝畸形', () => {
    const ok = buildFidelityReport([{ path: 'a', status: 'extracted' }], '2026-08-19T00:00:00.000Z')
    expect(isFidelityReport(ok)).toBe(true)
    expect(isFidelityReport(null)).toBe(false)
    expect(isFidelityReport({})).toBe(false)
    expect(isFidelityReport({ parsedAt: 'x', summary: {}, entries: 'no' })).toBe(false)
    expect(isFidelityReport({ ...ok, entries: [{ path: 'a', status: '乱写' }] })).toBe(false)
  })
})
