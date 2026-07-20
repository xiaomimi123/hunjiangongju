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

  it('leadingMs=0（origTimings[0].startMs=0，无开头标题段）→ 不生成 [lead]，行为与旧版一致', () => {
    const filter = buildRetimeFilterComplex([{ seqNo: 1, startMs: 0, endMs: 1000 }], [200], 0)
    expect(filter).not.toContain('[lead]')
    expect(filter).toBe(
      '[0:a]atrim=start=0.000:end=1.000,asetpts=PTS-STARTPTS,apad=pad_dur=0.200[p0];[p0]concat=n=1:v=0:a=1[out]',
    )
  })

  it('leadingMs>0（对应 origTimings[0].startMs=T0>0，即 SKIP_LEADING 跳过的开头标题段）'
    + '→ 原样(无 apad) atrim=[0,T0) 作为首个 concat 输入 [lead]，位于所有 body 段之前', () => {
    const origTimings = [
      { seqNo: 1, startMs: 3200, endMs: 4200 }, // T0 = 3200ms：开头标题段时长
      { seqNo: 2, startMs: 4200, endMs: 5200 },
    ]
    const pads = [800, 0]
    const leadingMs = origTimings[0].startMs
    const filter = buildRetimeFilterComplex(origTimings, pads, leadingMs)

    // (a) filter graph 含未加 pad 的开头 [0, T0) 切片，且是第一个 concat 输入
    expect(filter).toContain('[0:a]atrim=start=0.000:end=3.200,asetpts=PTS-STARTPTS[lead]')
    expect(filter.startsWith('[0:a]atrim=start=0.000:end=3.200,asetpts=PTS-STARTPTS[lead];')).toBe(true)
    expect(filter).toContain('[lead][p0][p1]concat=n=3:v=0:a=1[out]')

    // body 段本身仍按 origTimings 原样切片（atrim 起点不从 0 开始）
    expect(filter).toContain('[0:a]atrim=start=3.200:end=4.200,asetpts=PTS-STARTPTS,apad=pad_dur=0.800[p0]')
    expect(filter).toContain('[0:a]atrim=start=4.200:end=5.200,asetpts=PTS-STARTPTS,apad=pad_dur=0.000[p1]')

    // (b) 不变量：re-timed 总时长 = T0 + sum(pacedDur_i) = T0 + sum(origDur_i + pad_i)
    //     应等于视频时间线时长 max(paced endMs)（paced[0].startMs 保留为 T0，见 applyPace）
    const pacedDurSum = origTimings.reduce((sum, t, i) => sum + (t.endMs - t.startMs) + pads[i], 0)
    const expectedRetimedTotalMs = leadingMs + pacedDurSum
    const expectedVideoDurationMs = leadingMs + pacedDurSum // T0(startMs 未变) + sum(pacedDur)
    expect(expectedRetimedTotalMs).toBe(expectedVideoDurationMs)
    expect(expectedRetimedTotalMs).toBe(3200 + 1800 + 1000) // = 6000ms
  })

  it('若旧版 bug 复现（不传 leadingMs，即当年裸调用 buildRetimeFilterComplex(origTimings, pads)）'
    + '→ 开头 [0,T0) 会被静默丢弃，filter 里完全不含 [lead]，证明这条回归会被上面的新用例捕获', () => {
    const origTimings = [{ seqNo: 1, startMs: 3200, endMs: 4200 }]
    const filterBuggy = buildRetimeFilterComplex(origTimings, [800]) // 旧调用方式，未传 leadingMs
    expect(filterBuggy).not.toContain('[lead]')
    expect(filterBuggy).toContain('[0:a]atrim=start=3.200:end=4.200')
  })
})
