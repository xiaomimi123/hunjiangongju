import { describe, it, expect } from 'vitest'
import { buildRetimeFilterComplex } from './retimeAudio'

describe('buildRetimeFilterComplex（音频感知 re-timing 的 ffmpeg filter_complex，纯函数）', () => {
  it('单段：atrim 起止(秒) + apad pad_dur(秒) + concat n=1', () => {
    const filter = buildRetimeFilterComplex([{ seqNo: 1, startMs: 0, endMs: 1500 }], [500])
    expect(filter).toBe(
      '[0:a]atrim=start=0.000:end=1.500,asetpts=PTS-STARTPTS,apad=pad_dur=0.500[p0];[p0]concat=n=1:v=0:a=1[out]',
    )
  })

  it('多段：按序生成 p0..pN-1，concat 标签顺序与输入顺序一致', () => {
    const filter = buildRetimeFilterComplex(
      [
        { seqNo: 1, startMs: 0, endMs: 1000 },
        { seqNo: 2, startMs: 1200, endMs: 2200 },
      ],
      [0, 300],
    )
    expect(filter).toContain('[0:a]atrim=start=0.000:end=1.000,asetpts=PTS-STARTPTS,apad=pad_dur=0.000[p0]')
    expect(filter).toContain('[0:a]atrim=start=1.200:end=2.200,asetpts=PTS-STARTPTS,apad=pad_dur=0.300[p1]')
    expect(filter.endsWith('[p0][p1]concat=n=2:v=0:a=1[out]')).toBe(true)
  })

  it('负 pad 被 clamp 到 0（防御性：调用方本应已 clamp，这里兜底）', () => {
    const filter = buildRetimeFilterComplex([{ seqNo: 1, startMs: 0, endMs: 1000 }], [-50])
    expect(filter).toContain('apad=pad_dur=0.000[p0]')
  })

  it('空 timings → 抛错', () => {
    expect(() => buildRetimeFilterComplex([], [])).toThrow()
  })

  it('pads 长度与 timings 不符 → 抛错', () => {
    expect(() => buildRetimeFilterComplex([{ seqNo: 1, startMs: 0, endMs: 1000 }], [])).toThrow()
  })
})
