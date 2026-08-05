import { describe, it, expect } from 'vitest'
import { extractDraftStructure } from './draftStructure'

// 主视频轨 = attribute===1；1 开场 + 3 快闪 + 2 正片
// materials.videos[]：v0~v5 都标为 photo（与素材类型无关的既有断言保持不变）
const draft = {
  materials: {
    videos: [
      { id: 'v0', type: 'photo' },
      { id: 'v1', type: 'photo' },
      { id: 'v2', type: 'photo' },
      { id: 'v3', type: 'photo' },
      { id: 'v4', type: 'photo' },
      { id: 'v5', type: 'photo' },
    ],
  },
  tracks: [
    { type: 'video', attribute: 0, segments: [{ material_id: 'x', target_timerange: { duration: 9_999_000 } }] }, // 装饰轨,须忽略
    { type: 'video', attribute: 1, segments: [
      { material_id: 'v0', target_timerange: { start: 0, duration: 1_500_000 }, clip: { scale: { x: 1 } } },
      { material_id: 'v1', target_timerange: { start: 1_500_000, duration: 100_000 }, clip: { scale: { x: 1.1 } } },
      { material_id: 'v2', target_timerange: { start: 1_600_000, duration: 133_000 }, clip: { scale: { x: 1.12 } } },
      { material_id: 'v3', target_timerange: { start: 1_733_000, duration: 100_000 }, clip: { scale: { x: 1.14 } } },
      { material_id: 'v4', target_timerange: { start: 1_833_000, duration: 6_067_000 }, clip: { scale: { x: 1.3 } } },
      { material_id: 'v5', target_timerange: { start: 7_900_000, duration: 7_033_000 }, clip: { scale: { x: 1.5 } } },
    ] },
  ],
}

describe('extractDraftStructure', () => {
  it('切出 开场/快闪/正片 三段并给出节奏', () => {
    const s = extractDraftStructure(draft)
    expect(s.openDurationMs).toBe(1500)
    expect(s.flashCount).toBe(3)
    expect(s.flashMinClipMs).toBe(100)
    expect(s.flashPerClipMs).toBe(111) // (100+133+100)/3 四舍五入
    expect(s.bodyCount).toBe(2)
    expect(s.bodyAvgMs).toBe(6550)    // (6067+7033)/2
  })
  it('缩放取各自中位数', () => {
    const s = extractDraftStructure(draft)
    expect(s.flashScale).toBeCloseTo(1.12, 3)
    expect(s.bodyScale).toBeCloseTo(1.4, 3)  // (1.3+1.5)/2 偶数取中间两值均值
  })
  it('标注每段角色', () => {
    expect(extractDraftStructure(draft).segments.map((x) => x.role)).toEqual(['open', 'flash', 'flash', 'flash', 'body', 'body'])
  })
  it('无快闪段（全长段）→ flash 计数为 0,其余段全归正片', () => {
    const s = extractDraftStructure({ tracks: [{ type: 'video', attribute: 1, segments: [
      { target_timerange: { duration: 2_000_000 } }, { target_timerange: { duration: 5_000_000 } },
    ] }] })
    expect(s.flashCount).toBe(0)
    expect(s.bodyCount).toBe(1)
    expect(s.openDurationMs).toBe(2000)
  })
  it('非法输入 → 全 0/1 不抛错', () => {
    const s = extractDraftStructure(null)
    expect(s).toEqual({ openDurationMs: 0, flashCount: 0, flashPerClipMs: 0, flashMinClipMs: 0, bodyCount: 0, bodyAvgMs: 0, flashScale: 1, bodyScale: 1, segments: [] })
  })
})

describe('extractDraftStructure：缩放基准只取 photo 素材段（排除 video 素材，如实拍/成片镜头）', () => {
  it('正片段里混入 video 素材段 → bodyScale 只算 photo 段的中位数', () => {
    const d = {
      materials: { videos: [
        { id: 'b_video', type: 'video' },
        { id: 'b_photo', type: 'photo' },
      ] },
      tracks: [{ type: 'video', attribute: 1, segments: [
        { material_id: 'open0', target_timerange: { duration: 1_000_000 }, clip: { scale: { x: 1 } } }, // open
        { material_id: 'b_video', target_timerange: { duration: 5_000_000 }, clip: { scale: { x: 2 } } },   // body, video 素材, scale 2
        { material_id: 'b_photo', target_timerange: { duration: 5_000_000 }, clip: { scale: { x: 1.5 } } }, // body, photo 素材, scale 1.5
      ] }],
    }
    const s = extractDraftStructure(d)
    expect(s.bodyCount).toBe(2) // 计数/角色不受影响，两段都算 body
    expect(s.bodyScale).toBe(1.5) // 若把 video 段(scale 2)也算进去会是 1.75，只取 photo 段应为 1.5
  })
  it('某角色全是 video 素材段（无 photo）→ 该角色 scale 回退默认值 1', () => {
    const d = {
      materials: { videos: [
        { id: 'b_video1', type: 'video' },
        { id: 'b_video2', type: 'video' },
      ] },
      tracks: [{ type: 'video', attribute: 1, segments: [
        { material_id: 'open0', target_timerange: { duration: 1_000_000 }, clip: { scale: { x: 1 } } },
        { material_id: 'b_video1', target_timerange: { duration: 5_000_000 }, clip: { scale: { x: 2 } } },
        { material_id: 'b_video2', target_timerange: { duration: 5_000_000 }, clip: { scale: { x: 3 } } },
      ] }],
    }
    const s = extractDraftStructure(d)
    expect(s.bodyCount).toBe(2)
    expect(s.bodyScale).toBe(1) // 全是 video 素材，photo 段为空 → 回退默认 1（而不是 2/3 的中位数 2.5）
  })
})
