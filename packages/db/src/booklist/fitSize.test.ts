import { describe, it, expect } from 'vitest'
import { fitSizePx } from './fitSize'

describe('fitSizePx', () => {
  it('按最长的那一行量，不是整串 —— 换行符与 ASS 的 \\N 都要切', () => {
    // 线上事故：「《被讨厌的勇气》\N岸见一郎、古贺史健」被当成一行 18 字，
    // 100px 被缩到 35px，比正文字幕还小。
    expect(fitSizePx('《九字书名啊》\\N作者', 100, 720)).toBe(fitSizePx('《九字书名啊》', 100, 720))
  })

  it('短文本不缩，保持基准字号', () => {
    // 「短」1 个中文字 = 1 cell，可用宽度 720 - 40*2 = 640，max = 640 远大于 basePx，
    // 所以取 Math.min(basePx, max) = basePx。
    expect(fitSizePx('短', 60, 720)).toBe(60)
  })

  it('超长文本缩到下限 18px', () => {
    // 40 个中文字 = 40 cells，可用宽度 640，max = floor(640/40) = 16 < 18，
    // 触发 Math.max(18, ...) 下限保护。
    expect(fitSizePx('一'.repeat(40), 100, 720)).toBe(18)
  })

  it('marginPx 生效 —— 边距越大可用宽度越小，字号越容易被压缩', () => {
    // widthPx=100, 4 个中文字 = 4 cells。
    // marginPx=0：可用宽度 100，max = floor(100/4) = 25，取 min(100,25) = 25。
    // marginPx=40：可用宽度 100-80=20，max = floor(20/4) = 5 < 18，取下限 18。
    expect(fitSizePx('一二三四', 100, 100, 0)).toBe(25)
    expect(fitSizePx('一二三四', 100, 100, 40)).toBe(18)
  })

  it('ASCII 字符按半个 cell 估宽，同长度英文比中文能容纳更大字号', () => {
    // 4 个 ASCII 字符 = 4*0.5 = 2 cells，可用宽度 100，max = floor(100/2) = 50，
    // 取 min(100,50) = 50，明显大于同宽度 4 个中文字的 25。
    expect(fitSizePx('abcd', 100, 100, 0)).toBe(50)
  })

  it('空文本直接返回基准字号', () => {
    // cells <= 0 时直接 return basePx，不进入缩放逻辑。
    expect(fitSizePx('', 60, 720)).toBe(60)
  })
})
