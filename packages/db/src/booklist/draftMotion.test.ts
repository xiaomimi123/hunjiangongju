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
  it('快闪段(role=flash)的关键帧即使超过阈值也被排除,只取正片段(role=body)', () => {
    // 开场后紧跟 3 段 <500ms 的短段 → 按 extractDraftStructure 判为快闪(role=flash)，
    // 即便它们带的缩放脉冲(卡片弹入效果)幅度超过 EPS，也不应进入 moves；
    // 第 5 段(6000ms) role=body，其位移关键帧才应被采纳。
    const d = { tracks: [{ type: 'video', attribute: 1, segments: [
      { target_timerange: { duration: 1_500_000 } }, // 开场
      { target_timerange: { duration: 150_000 }, common_keyframes: [kf('KFTypeScaleX', [[0, 1.0], [150, 1.15]])] }, // 快闪卡片微缩放脉冲
      { target_timerange: { duration: 180_000 }, common_keyframes: [kf('KFTypeScaleX', [[0, 1.0], [180, 1.12]])] }, // 同上
      { target_timerange: { duration: 200_000 }, common_keyframes: [kf('KFTypeScaleX', [[0, 1.0], [200, 1.10]])] }, // 同上
      { target_timerange: { duration: 6_000_000 }, common_keyframes: [kf('KFTypePositionX', [[0, 0], [6000, 0.125]])] }, // 正片段
    ] }] }
    expect(extractDraftMoves(d)).toEqual(['pan-right'])
  })
  it('ScaleX/ScaleY 符号相反时取幅度更大者，不受数组书写顺序影响', () => {
    const d = { tracks: [{ type: 'video', attribute: 1, segments: [
      { target_timerange: { duration: 1000 } },
      { target_timerange: { duration: 6_000_000 }, common_keyframes: [
        kf('KFTypeScaleX', [[0, 1.0], [6000, 1.05]]), // Δ+0.05，排在前面但幅度小
        kf('KFTypeScaleY', [[0, 1.3], [6000, 1.0]]),  // Δ-0.3，排在后面但幅度大 → 应被选中
      ] },
    ] }] }
    expect(extractDraftMoves(d)).toEqual(['pull-back'])
  })
})
