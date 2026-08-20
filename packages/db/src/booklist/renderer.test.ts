import { describe, it, expect } from 'vitest'
import { readRenderer } from './renderer'

// 默认翻成 ffmpeg 的两个理由(见 renderer.ts 顶部):成本差 8 倍;
// 而且开关只能写在 overlayTemplate 里,后台编辑页保存会把它整体覆写掉 ——
// 线上实测用 SQL 设好的开关被一次「保存」抹掉过。
describe('readRenderer', () => {
  it('缺省走 ffmpeg', () => {
    expect(readRenderer(null)).toBe('ffmpeg')
    expect(readRenderer({})).toBe('ffmpeg')
    expect(readRenderer(undefined)).toBe('ffmpeg')
  })
  it('只有显式写 hyperframes 才退回旧渲染器', () => {
    expect(readRenderer({ __renderer: 'hyperframes' })).toBe('hyperframes')
  })
  // 写错开关不该把整条线悄悄切走
  it('脏值一律走 ffmpeg，不因写错而退回旧渲染器', () => {
    expect(readRenderer({ __renderer: 'HYPERFRAMES' })).toBe('ffmpeg')
    expect(readRenderer({ __renderer: 'hyper' })).toBe('ffmpeg')
    expect(readRenderer({ __renderer: 1 })).toBe('ffmpeg')
    expect(readRenderer({ __renderer: true })).toBe('ffmpeg')
    expect(readRenderer('不是对象')).toBe('ffmpeg')
    expect(readRenderer([{ __renderer: 'hyperframes' }])).toBe('ffmpeg')
  })
})
