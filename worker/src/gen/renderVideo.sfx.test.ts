import { describe, it, expect } from 'vitest'
import { buildFfmpegArgs } from './renderVideo'

const base = { bodyAbs: 'b.mp4', audioAbs: 'a.wav', durSec: 24.6, outAbs: 'o.mp4' }

describe('buildFfmpegArgs — SFX', () => {
  it('无 sfx/bgm → 只人声(原行为)', () => {
    const a = buildFfmpegArgs({ ...base, bgmAbs: null }).join(' ')
    expect(a).toContain('loudnorm'); expect(a).not.toContain('adelay')
  })
  it('带 bgm + sfx → 齿轮/水滴进 amix，bgmVolume 生效', () => {
    const a = buildFfmpegArgs({ ...base, bgmAbs: 'bgm.mp3', bgmVolume: 0.69,
      sfx: { gearAbs: 'gear.mp3', dropAbs: 'drop.mp3', openEndSec: 2.16, dropAtSec: 3.98 } }).join(' ')
    expect(a).toContain('gear.mp3'); expect(a).toContain('drop.mp3')
    expect(a).toContain('adelay=3980|3980')       // 水滴延迟到 3.98s
    expect(a).toContain('volume=0.69')            // bgm 音量参数化
    expect(a).toMatch(/amix=inputs=[34]/)         // 人声+bgm+齿轮+水滴
  })
})
