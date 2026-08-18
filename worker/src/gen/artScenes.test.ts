import { describe, it, expect } from 'vitest'
import { ART_SCENES, pickArtScenes, buildFreeArtPrompt } from './artScenes'

describe('pickArtScenes', () => {
  it('同一 seed 结果稳定（同任务重跑一致）', () => {
    expect(pickArtScenes('task-a', 6)).toEqual(pickArtScenes('task-a', 6))
  })

  it('不同 seed 结果不同（不同任务配图不重样）', () => {
    expect(pickArtScenes('task-a', 6)).not.toEqual(pickArtScenes('task-b', 6))
  })

  it('分镜数不超过池子时互不重复', () => {
    const out = pickArtScenes('task-a', 8)
    expect(out).toHaveLength(8)
    expect(new Set(out).size).toBe(8)
  })

  it('分镜数超过池子时循环复用，不抛错', () => {
    const n = ART_SCENES.length + 3
    const out = pickArtScenes('task-a', n)
    expect(out).toHaveLength(n)
    expect(out[ART_SCENES.length]).toBe(out[0])
  })

  it('每个方向都来自池子', () => {
    for (const s of pickArtScenes('task-c', 10)) expect(ART_SCENES).toContain(s)
  })

  it('n 为 0 或负数 → 空数组', () => {
    expect(pickArtScenes('task-a', 0)).toEqual([])
    expect(pickArtScenes('task-a', -1)).toEqual([])
  })
})

describe('buildFreeArtPrompt', () => {
  it('画风 + 场景方向 + 禁文字约束', () => {
    const p = buildFreeArtPrompt('梵高后印象派风格,旋转笔触', '风吹过的麦田')
    expect(p).toContain('梵高后印象派风格,旋转笔触')
    expect(p).toContain('风吹过的麦田')
    expect(p).toContain('不出现任何文字、字幕或水印')
    expect(p).toContain('竖屏')
  })

  it('提示词里不含任何文案内容（主体只来自场景方向）', () => {
    // 这条是本次改动的核心：配图提示词与口播文案完全脱钩
    const p = buildFreeArtPrompt('某画风', '星空下的夜色')
    expect(p).toBe('某画风，星空下的夜色，竖屏背景，纯画面，不出现任何文字、字幕或水印')
  })

  it('画风为空时不留空段', () => {
    expect(buildFreeArtPrompt('', '麦田')).toBe('麦田，竖屏背景，纯画面，不出现任何文字、字幕或水印')
    expect(buildFreeArtPrompt('   ', '麦田')).not.toContain('，，')
  })
})
