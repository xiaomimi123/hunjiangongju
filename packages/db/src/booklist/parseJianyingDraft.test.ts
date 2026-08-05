import { describe, it, expect } from 'vitest'
import { parseJianyingDraft, transformYToNorm } from './parseJianyingDraft'
import { DEFAULT_PARAMS } from './templateParams'

const draft = {
  canvas_config: { width: 720, height: 960 },
  duration: 24601783,
  materials: {
    texts: [
      { id: 't_title', content: JSON.stringify({ text: '今天分享的是', styles: [{ font: { path: 'text/x/字由玄真.ttf' }, fill: { content: { solid: { color: [0,0,0] } } } }] }) },
      { id: 't_b1', content: JSON.stringify({ text: '《活着》', styles: [{ font: { path: 'text/x/字由玄真.ttf' }, fill: { content: { solid: { color: [0,0,0] } } } }] }) },
      { id: 't_sub', content: JSON.stringify({ text: '没有人能替你抚平情绪', styles: [{ font: { path: 'text/y/莫雪体.ttf' }, fill: { content: { solid: { color: [1,1,1] } } } }] }) },
    ],
    material_animations: [{ id: 'a1', animations: [{ name: '破镜重圆' }] }],
    transitions: [{ id: 'tr1', name: '叠化', duration: 500000 }],
    audios: [
      { id: 'au_bgm', name: '歌曲20260702' }, { id: 'au_gear', name: '发条旋钮转动齿轮' }, { id: 'au_drop', name: '一滴水滴声' },
    ],
  },
  tracks: [
    { type: 'video', segments: [ { target_timerange: { duration: 2158988 } }, { target_timerange: { duration: 3000000 } } ] },
    { type: 'audio', segments: [ { material_id: 'au_bgm', volume: 0.692, target_timerange: { start: 0, duration: 20000000 } } ] },
    { type: 'audio', segments: [ { material_id: 'au_gear', target_timerange: { start: 2158988, duration: 1800000 } } ] },
    { type: 'audio', segments: [ { material_id: 'au_drop', volume: 0.51, target_timerange: { start: 3984033, duration: 500000 } } ] },
    { type: 'sticker', segments: [
      { material_id: 't_title', target_timerange: { start: 0, duration: 2158988 }, clip: { transform: { y: -0.62 } }, extra_material_refs: ['a1'] },
      { material_id: 't_b1', target_timerange: { start: 2158988, duration: 150300 }, clip: { transform: { y: 0.66 } }, extra_material_refs: [] },
      { material_id: 't_sub', target_timerange: { start: 15509000, duration: 2321000 }, clip: { transform: { y: -0.486 } }, extra_material_refs: [] },
    ] },
  ],
}

describe('parseJianyingDraft', () => {
  it('抽取 flash 配方核心字段', () => {
    const { params, meta } = parseJianyingDraft(draft)
    expect(params.mode).toBe('flash')
    expect(params.open.titleText).toBe('今天分享的是')
    expect(params.open.durationMs).toBe(2159)          // 2158988μs→ms
    expect(params.open.shatter).toBe(true)             // 破镜重圆
    expect(params.transition.durationMs).toBe(500)     // 叠化 500000μs
    expect(params.audio.bgmVolume).toBeCloseTo(0.692, 2)
    expect(params.audio.sfx.openGear).toBe(true)       // 齿轮
    expect(params.audio.sfx.transitionDrop).toBe(true) // 水滴
    expect(params.flash.perClipMs).toBe(150)           // 书名段 150300μs→150ms
  })
  it('meta：画布/字体/书名', () => {
    const { meta } = parseJianyingDraft(draft)
    expect(meta.canvas).toEqual({ width: 720, height: 960 })
    expect(meta.segmentCount).toBe(2)
    expect(meta.fontsNeeded).toEqual(expect.arrayContaining(['字由玄真', '莫雪体']))
    expect(meta.bookTitles).toContain('活着')
    expect(meta.durationMs).toBe(24602)
  })
  it('字幕样式：字体/颜色/位置换算', () => {
    const { params } = parseJianyingDraft(draft)
    expect(params.body.subtitleFontFamily).toBe('subtitle')     // 莫雪体→subtitle
    expect(params.body.subtitleColor).toBe('#ffffff')           // [1,1,1]
    // y=-0.486(靠下三分之一) → 0.743(ground truth，非原先反号公式算出的 0.257，那会把字幕渲染到画面顶部)
    expect(params.body.subtitlePosY).toBeCloseTo(0.743, 3)
  })
  it('非对象/空 → 全默认不抛错', () => {
    expect(() => parseJianyingDraft(null)).not.toThrow()
    const { params, meta } = parseJianyingDraft({})
    expect(params.mode).toBe('flash')
    expect(meta.warnings.length).toBeGreaterThan(0)
  })

  it('BGM 避开剪映自动生成的"提取音乐"参考轨，优先选"歌曲"轨', () => {
    const d = {
      materials: {
        audios: [
          { id: 'au_extract', name: '提取音乐20260101' },
          { id: 'au_song', name: '歌曲ABC' },
        ],
      },
      tracks: [
        { type: 'audio', segments: [
          // 提取音乐：时长更长，但没有 volume，且属于参考轨，不应被选中
          { material_id: 'au_extract', target_timerange: { start: 0, duration: 30000000 } },
        ] },
        { type: 'audio', segments: [
          // 歌曲：时长更短，但有明确 volume，应被选中
          { material_id: 'au_song', volume: 0.7, target_timerange: { start: 0, duration: 5000000 } },
        ] },
      ],
    }
    const { params } = parseJianyingDraft(d)
    expect(params.audio.bgmVolume).toBeCloseTo(0.7, 2)
  })

  it('BGM 候选无 volume → 回退默认音量并告警', () => {
    const d = {
      materials: {
        audios: [{ id: 'au_song', name: '歌曲XYZ' }],
      },
      tracks: [
        { type: 'audio', segments: [
          { material_id: 'au_song', target_timerange: { start: 0, duration: 5000000 } }, // 无 volume
        ] },
      ],
    }
    const { params, meta } = parseJianyingDraft(d)
    expect(params.audio.bgmVolume).toBe(DEFAULT_PARAMS.audio.bgmVolume)
    expect(meta.warnings.some((w) => /bgm/i.test(w))).toBe(true)
  })

  it('缺失 material_animations → shatter/kenBurns 回退默认值并告警', () => {
    const { material_animations: _omit, ...restMaterials } = draft.materials as Record<string, unknown>
    const d = { ...draft, materials: restMaterials }
    const { params, meta } = parseJianyingDraft(d)
    expect(params.open.shatter).toBe(true)
    expect(params.body.kenBurns).toBe('subtle')
    expect(meta.warnings.some((w) => /material_animations|动画素材/.test(w))).toBe(true)
  })
})

// transformYToNorm 符号约定 ground truth（跨样本实测，见 parseJianyingDraft.ts 里的注释）：
// clip.transform.y 正=靠上、负=靠下；下游 subtitlePosY 是"离底部的归一化距离"(0.78≈下三分)。
describe('transformYToNorm：y 正=靠上/负=靠下，转换到"离底部距离"', () => {
  it('底部三分之一字幕 y=-0.486 → ≈0.743(靠下，>0.5)', () => {
    expect(transformYToNorm(-0.486)).toBeCloseTo(0.743, 3)
  })
  it('顶部书名/快闪文字 y=+0.663 → ≈0.1685(靠上，<0.5)', () => {
    expect(transformYToNorm(0.663)).toBeCloseTo(0.1685, 3)
  })
})

const P = '##_draftpath_placeholder_X_##'
function textDraft(trackType: 'text' | 'sticker') {
  return {
    canvas_config: { width: 834, height: 1112 },
    duration: 33_500_000,
    materials: {
      texts: [
        { id: 't1', content: JSON.stringify({ text: '今天分享的是', styles: [{ font: { path: 'x/font.ttf' }, fill: { content: { solid: { color: [1, 1, 1] } } } }] }) },
        { id: 't2', content: JSON.stringify({ text: '@欧子好读', styles: [{ font: { path: 'a/SourceHanSerifCN-Heavy.otf' }, fill: { content: { solid: { color: [1, 1, 1] } } } }] }) },
        // 真实样例里的免责声明：y<0(靠下)、比标题晚出现，但不以 @ 开头——曾被旧的"y<0 优先"判据误当成开场标题
        { id: 't3', content: JSON.stringify({ text: '内容来自书评/感悟/素材来源于网络', styles: [{ font: { path: 'a/SourceHanSerifCN-Heavy.otf' }, fill: { content: { solid: { color: [1, 1, 1] } } } }] }) },
      ],
      material_animations: [{ id: 'an1', animations: [{ name: '玻璃聚集', type: 'in', duration: 1_300_000 }] }],
      audios: [{ id: 'sfx1', name: '鼠标单击', type: 'sound', path: `${P}/audio/click.mp3` }],
    },
    tracks: [
      { type: trackType, segments: [
        { material_id: 't1', target_timerange: { start: 200_000, duration: 1_300_000 }, clip: { transform: { y: 0.374 } }, extra_material_refs: [] },
        { material_id: 't2', target_timerange: { start: 2_967_000, duration: 28_933_000 }, clip: { transform: { y: -0.793 } }, extra_material_refs: [] },
        { material_id: 't3', target_timerange: { start: 2_966_666, duration: 28_933_000 }, clip: { transform: { y: -0.889 } }, extra_material_refs: [] },
      ] },
      { type: 'audio', segments: [{ material_id: 'sfx1', target_timerange: { start: 5_167_000, duration: 367_000 } }] },
    ],
  }
}

describe('文字轨兼容 text 与 sticker', () => {
  it.each(['text', 'sticker'] as const)('%s 轨都能读出开场标题', (tt) => {
    const { params } = parseJianyingDraft(textDraft(tt))
    expect(params.open.titleText).toBe('今天分享的是')
  })
  it.each(['text', 'sticker'] as const)('%s 轨都能读出 @ 水印', (tt) => {
    const { meta } = parseJianyingDraft(textDraft(tt))
    expect(meta.watermark).toBe('@欧子好读')
  })
})

describe('开场动画与音效识别放宽', () => {
  it('「玻璃聚集」算碎裂开场', () => {
    expect(parseJianyingDraft(textDraft('text')).params.open.shatter).toBe(true)
  })
  it('「鼠标单击」算开场音效', () => {
    expect(parseJianyingDraft(textDraft('text')).params.audio.sfx.openGear).toBe(true)
  })
})
