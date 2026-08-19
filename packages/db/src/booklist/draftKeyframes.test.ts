import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'
import { extractDraftKeyframes } from './draftKeyframes'

const SAMPLE = path.resolve(__dirname, '../../../../今天分享的是/draft_content.json')
const hasSample = fs.existsSync(SAMPLE)

describe('extractDraftKeyframes', () => {
  it('畸形输入 → 空数组，不抛错', () => {
    expect(extractDraftKeyframes(null)).toEqual([])
    expect(extractDraftKeyframes({})).toEqual([])
    expect(extractDraftKeyframes({ tracks: 'x' })).toEqual([])
  })

  it('全片无任何缩放动画 → 返回空数组（让渲染层回退预设招式）', () => {
    const d = {
      canvas_config: { width: 720, height: 960 },
      tracks: [{ type: 'video', attribute: 1, segments: [
        { target_timerange: { start: 0, duration: 3000000 }, clip: { scale: { x: 1, y: 1 } } },
        { target_timerange: { start: 3000000, duration: 3000000 }, clip: { scale: { x: 1, y: 1 } } },
      ] }],
    }
    expect(extractDraftKeyframes(d)).toEqual([])
  })

  it.skipIf(!hasSample)('真实样例：正片 4 段，其中 3 段是实测推近、1 段仅静态缩放', () => {
    const draft = JSON.parse(fs.readFileSync(SAMPLE, 'utf8'))
    const out = extractDraftKeyframes(draft)
    expect(out).toHaveLength(4)
    // idx10：781ms，有 clip.scale 1.1893 但无关键帧 → 首尾相同的静态缩放
    expect(out[0].scaleFrom).toBeCloseTo(1.189, 3)
    expect(out[0].scaleTo).toBeCloseTo(1.189, 3)
    // idx11/12/13：实测线性推近。期望值是**经 coverRelativeScale 换算后**的口径，
    // 与 DraftStructure.segments[].scale 一致（渲染层的 photoScale 也用这个口径）。
    expect(out[1].scaleFrom).toBeCloseTo(0.99984375, 8)
    expect(out[1].scaleTo).toBeCloseTo(1.1073980229392701, 8)
    expect(out[2].scaleTo).toBeCloseTo(1.0823206803654237, 8)
    expect(out[3].scaleTo).toBeCloseTo(1.1054867089297913, 8)
  })

  it.skipIf(!hasSample)('换算确实被执行：结果不等于草稿里的原始 clip.scale 值', () => {
    // 这份样例的源图比例与画布只差一点点，换算系数约 0.99984——数值很小但必须做。
    // 若漏掉换算，比例不同的工程会静默算错构图。断言"不等于原值"才能证明换算真的跑了，
    // 只断言约等于换算值的话，实现里不做换算也可能因为差异太小而蒙混过关。
    const draft = JSON.parse(fs.readFileSync(SAMPLE, 'utf8'))
    const out = extractDraftKeyframes(draft)
    expect(out[1].scaleTo).not.toBe(1.107571080920664)   // 草稿原始值
    expect(out[1].scaleFrom).not.toBe(1)                  // 草稿原始值
  })

  it.skipIf(!hasSample)('单点占位轨与首尾相同的 Rotation/Position 不影响缩放提取', () => {
    const draft = JSON.parse(fs.readFileSync(SAMPLE, 'utf8'))
    // 样例每段 49 条属性轨里 44 条是单点占位、Rotation/Position 首尾均为 0
    const out = extractDraftKeyframes(draft)
    expect(out.every((k) => Number.isFinite(k.scaleFrom) && Number.isFinite(k.scaleTo))).toBe(true)
  })
})
