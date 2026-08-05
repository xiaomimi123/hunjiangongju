import { describe, it, expect } from 'vitest'
import { extractDraftGrade } from './draftGrade'

const draft = {
  materials: {
    effects: [
      { id: 'e1', name: '青橙', type: 'filter', value: 0.503 },
      { id: 'e2', name: '锐化', type: 'sharpen', value: 0 },
      { id: 'e3', name: '', type: 'contrast', value: -0.213836477987421 },
    ],
  },
}

describe('extractDraftGrade', () => {
  it('读出滤镜名/强度/对比度/锐化', () => {
    expect(extractDraftGrade(draft)).toEqual({ filterName: '青橙', intensity: 0.503, contrast: -0.2138, sharpen: true })
  })
  it('只有对比度、无滤镜 → filterName 空串', () => {
    expect(extractDraftGrade({ materials: { effects: [{ type: 'contrast', value: 0.5 }] } }))
      .toEqual({ filterName: '', intensity: 0, contrast: 0.5, sharpen: false })
  })
  it('无调色信息 → null', () => {
    expect(extractDraftGrade({ materials: { effects: [] } })).toBeNull()
    expect(extractDraftGrade(null)).toBeNull()
  })
})
