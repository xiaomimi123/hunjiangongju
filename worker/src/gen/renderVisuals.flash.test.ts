import { describe, it, expect } from 'vitest'
import { buildBodyData } from './renderVisuals'

const base = {
  variables: {},
  bodyTimings: [{ seqNo: 1, startMs: 0, endMs: 4000 }, { seqNo: 2, startMs: 4000, endMs: 9000 }],
}
const segs = [
  { seqNo: 1, scriptText: '今天分享的是', imageUrl: '/api/files/gen/x/1.png' },
  { seqNo: 2, scriptText: '如果你总困在过往', imageUrl: '/api/files/gen/x/2.png' },
]

describe('buildBodyData — flash', () => {
  it('flash 模式设 template/params/flashCovers/fonts', () => {
    const task = { ...base, framework: { overlayTemplate: { __templateParams: { mode: 'flash' }, books: [{ title: '活着', author: '余华' }, { title: '兄弟' }] } } }
    const { data } = buildBodyData(task as any, segs as any, 'gt1')
    expect(data.template).toBe('flash')
    expect(data.templateParams?.mode).toBe('flash')
    expect(data.flashCovers?.map((c: any) => c.title)).toEqual(['活着', '兄弟'])
    expect(data.flashCovers?.[0].coverSrc).toBe('covers/01.png')
    expect(data.fonts?.some((f: any) => f.family === 'flash-title')).toBe(true)
  })
  it('classic(缺省) 不设 flash 字段', () => {
    const task = { ...base, framework: { overlayTemplate: { title: '《x》' } } }
    const { data } = buildBodyData(task as any, segs as any, 'gt2')
    expect(data.template ?? 'classic').toBe('classic')
    expect(data.flashCovers).toBeUndefined()
  })
})
