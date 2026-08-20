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
      sfx: { gearAbs: 'gear.mp3', dropAbs: 'drop.mp3', openEndSec: 2.16, flashEndSec: 3.98, dropAtSec: 3.98 } }).join(' ')
    expect(a).toContain('gear.mp3'); expect(a).toContain('drop.mp3')
    expect(a).toContain('adelay=3980|3980')       // 水滴延迟到 3.98s
    expect(a).toContain('volume=0.69')            // bgm 音量参数化
    expect(a).toMatch(/amix=inputs=[34]/)         // 人声+bgm+齿轮+水滴
  })

  // 实测客户样例 今天分享的是/draft_content.json 的音频轨：
  //   发条旋钮转动齿轮  2.159s → 3.983s（= 开场结束 → 快闪结束，正好铺满 9 张书封轮播）
  //   一滴水滴声        3.984s → 4.514s（1.595s 的素材只用了 0.530s，音量 0.51）
  // 原实现把齿轮音写成 atrim=0:openEndSec 且不加 adelay —— 从 0 秒起播、盖在开场上，
  // 开场一结束就断，与草稿差了整整一段。
  it('齿轮音延迟到开场结束、铺满快闪段（不是从 0 秒盖在开场上）', () => {
    const a = buildFfmpegArgs({ ...base, bgmAbs: null,
      sfx: { gearAbs: 'gear.mp3', openEndSec: 2.159, flashEndSec: 3.983, dropAtSec: 3.983 } }).join(' ')
    expect(a).toContain('adelay=2159|2159')       // 起点 = 开场结束
    expect(a).toContain('atrim=0:1.824')          // 长度 = 快闪段时长
  })

  it('水滴音按草稿截到 0.53s，不让 1.6s 的尾音拖进正片', () => {
    const a = buildFfmpegArgs({ ...base, bgmAbs: null,
      sfx: { dropAbs: 'drop.mp3', openEndSec: 2.159, flashEndSec: 3.983, dropAtSec: 3.984 } }).join(' ')
    expect(a).toContain('atrim=0:0.530')
    expect(a).toContain('adelay=3984|3984')
  })

  it('快闪窗口非法（flashEnd <= openEnd）→ 不混入齿轮音，而不是产出负时长 atrim', () => {
    const a = buildFfmpegArgs({ ...base, bgmAbs: null,
      sfx: { gearAbs: 'gear.mp3', openEndSec: 3.0, flashEndSec: 3.0, dropAtSec: 3.0 } }).join(' ')
    expect(a).not.toContain('gear.mp3')
  })
  // 28 会把慢速运镜量化成 skip 块 —— 实测连续两帧完全不动再靠刷新补回来,
  // 肉眼就是卡顿(crf 28 卡住 4/35 帧, crf 24 卡住 0/35)。**不要为了体积调回 28。**
  it('编码用 crf 24（28 会把慢速运镜量化掉，产生卡顿）', () => {
    const a = buildFfmpegArgs({ bodyAbs:'b.mp4', audioAbs:'a.wav', bgmAbs:null, durSec:10, outAbs:'o.mp4' }).join(' ')
    expect(a).toContain('-crf 24')
    expect(a).not.toContain('-crf 28')
  })
})

// 线上事故（每条片子都中招）: 成片从约 2 秒起画面冻住、字幕整条消失。
//
// 定位过程: body.mp4(HyperFrames 产物) 577 帧全不同、完全正常; 冻结发生在混音这一步。
// 服务器 ffmpeg 5.1.9 上拿真 body.mp4 做隔离实验:
//   过 zoompan  → t=3/8/10 三个帧指纹完全相同(冻结)
//   不过 zoompan → 四个全不同
// 本机 ffmpeg 9.0.1 复现不出来 —— 是老版本 zoompan 在 d=1 时不逐帧取新输入的行为,
// 新版已修。服务器用 Debian 12 自带的 5.1.9,短期不打算换 ffmpeg,所以从滤镜链里去掉它。
//
// 顺带: 那个 1.12→1.0 的开场推近本来就是我们自己加的装饰,客户工程里没有这一下,
// 去掉反而更贴近「照抄工程文件」;开场动效已由 HTML 的碎裂层负责。
describe('buildFfmpegArgs —— 不得再用 zoompan', () => {
  it('滤镜链里没有 zoompan（老版 ffmpeg 上会冻帧）', () => {
    const a = buildFfmpegArgs({ ...base, bgmAbs: null }).join(' ')
    expect(a).not.toContain('zoompan')
  })

  it('仍保证输出尺寸与像素格式（原本由 zoompan 的 s= 参数兜着）', () => {
    const a = buildFfmpegArgs({ ...base, bgmAbs: null }).join(' ')
    expect(a).toContain('scale=720:960')
    expect(a).toContain('format=yuv420p')
  })

  it('开场淡入保留', () => {
    expect(buildFfmpegArgs({ ...base, bgmAbs: null }).join(' ')).toContain('fade=t=in:st=0:d=0.7')
  })
})
