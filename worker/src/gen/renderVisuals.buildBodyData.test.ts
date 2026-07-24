import { describe, it, expect } from 'vitest'
import { buildBodyData } from './renderVisuals'

const task = {
  variables: { title: '活着', author: '余华' },
  bodyTimings: [
    { seqNo: 1, startMs: 0, endMs: 2000 },
    { seqNo: 2, startMs: 2000, endMs: 4500 },
  ],
  framework: { overlayTemplate: { title: '《{{title}}》', watermark: '@读书号', __style: 'dark-premium' } },
}
const segments = [
  { seqNo: 1, scriptText: '第一句', imageUrl: '/api/files/gen/x/1.png' },
  { seqNo: 2, scriptText: '第二句', imageUrl: '/api/files/gen/x/2.png' },
]

describe('buildBodyData —— style/seed 注入', () => {
  it('seed 取 genTaskId', () => {
    const { data } = buildBodyData(task as any, segments as any, 'gen-task-123')
    expect(data.seed).toBe('gen-task-123')
  })
  it('style 取 overlayTemplate.__style（字符串时）', () => {
    const { data } = buildBodyData(task as any, segments as any, 'gen-task-123')
    expect(data.style).toBe('dark-premium')
  })
  it('overlayTemplate 无 __style 时 style 为 undefined（走 seed 派生）', () => {
    const t2 = { ...task, framework: { overlayTemplate: { title: 'x', watermark: 'y' } } }
    const { data } = buildBodyData(t2 as any, segments as any, 'g')
    expect(data.style).toBeUndefined()
  })
})
