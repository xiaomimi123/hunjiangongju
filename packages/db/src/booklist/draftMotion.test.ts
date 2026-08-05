import { describe, it, expect } from 'vitest'
import { extractDraftMoves } from './draftMotion'

const kf = (prop: string, pts: [number, number][]) => ({
  property_type: prop,
  keyframe_list: pts.map(([t, v]) => ({ time_offset: t * 1000, values: [v] })),
})
const draft = {
  tracks: [{ type: 'video', attribute: 1, segments: [
    { target_timerange: { duration: 1_500_000 } },                                   // 开场,跳过
    { target_timerange: { duration: 7_033_000 }, common_keyframes: [kf('KFTypePositionX', [[0, 0], [7033, 0.125]])] },   // 右移
    { target_timerange: { duration: 6_000_000 }, common_keyframes: [kf('KFTypePositionX', [[0, 0.1], [6000, -0.05]])] }, // 左移
    { target_timerange: { duration: 6_000_000 }, common_keyframes: [kf('KFTypePositionY', [[0, 0], [6000, -0.08]])] },   // 上移(剪映 y 向上为负)
    { target_timerange: { duration: 6_000_000 }, common_keyframes: [kf('KFTypeScaleX', [[0, 1.0], [6000, 1.2]])] },      // 推近
    { target_timerange: { duration: 6_000_000 }, common_keyframes: [kf('KFTypeScaleY', [[0, 1.2], [6000, 1.0]])] },      // 拉远
    { target_timerange: { duration: 6_000_000 }, common_keyframes: [kf('KFTypePositionX', [[0, 0], [6000, 0.001]])] },   // 变化过小,不产出
    { target_timerange: { duration: 6_000_000 } },                                                                        // 无关键帧,不产出
  ] }],
}

describe('extractDraftMoves', () => {
  it('按段分类出运镜序列（跳过开场段与无显著变化的段）', () => {
    expect(extractDraftMoves(draft)).toEqual(['pan-right', 'pan-left', 'drift-up', 'push-in', 'pull-back'])
  })
  it('位移与缩放同时存在时取变化量更大的一项', () => {
    const d = { tracks: [{ type: 'video', attribute: 1, segments: [
      { target_timerange: { duration: 1000 } },
      { target_timerange: { duration: 6_000_000 }, common_keyframes: [
        kf('KFTypePositionX', [[0, 0], [6000, 0.03]]),
        kf('KFTypeScaleX', [[0, 1.0], [6000, 1.5]]),
      ] },
    ] }] }
    expect(extractDraftMoves(d)).toEqual(['push-in'])
  })
  it('非法输入 → 空数组', () => {
    expect(extractDraftMoves(null)).toEqual([])
    expect(extractDraftMoves({ tracks: [] })).toEqual([])
  })
})
