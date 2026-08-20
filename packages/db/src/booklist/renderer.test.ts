import { describe, it, expect } from 'vitest'
import { readRenderer } from './renderer'

// 默认值站在「不动线上」那一侧：新渲染器的画面与旧的有可感知差异
// (字号换算、开场形态、水波纹形态),不该因为发了一版代码就让存量框架的成片变样。
describe('readRenderer', () => {
  it('缺省走 hyperframes（不动线上）', () => {
    expect(readRenderer(null)).toBe('hyperframes')
    expect(readRenderer({})).toBe('hyperframes')
    expect(readRenderer(undefined)).toBe('hyperframes')
  })
  it('显式声明才走 ffmpeg', () => {
    expect(readRenderer({ __renderer: 'ffmpeg' })).toBe('ffmpeg')
  })
  it('脏值回落 hyperframes，不因写错开关把线上切走', () => {
    expect(readRenderer({ __renderer: 'FFMPEG' })).toBe('hyperframes')
    expect(readRenderer({ __renderer: 1 })).toBe('hyperframes')
    expect(readRenderer({ __renderer: true })).toBe('hyperframes')
    expect(readRenderer('不是对象')).toBe('hyperframes')
    expect(readRenderer([{ __renderer: 'ffmpeg' }])).toBe('hyperframes')
  })
})
