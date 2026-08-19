import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'
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

// 真实样例（未跟踪目录，可能不存在，缺失时用 it.skipIf 跳过样例相关用例）
const SAMPLE = path.resolve(__dirname, '../../../../今天分享的是/draft_content.json')
const hasSample = fs.existsSync(SAMPLE)

describe('parseJianyingDraft —— provenance', () => {
  it('meta.provenance 非空，且每条 warning 都有对应的 defaulted 条目', () => {
    // 用空对象夹具：几乎所有字段都读不到，会触发一整批 warnings.push，
    // 适合验证「每条 warning 都能在 provenance 里找到对应 defaulted 条目」
    const { meta } = parseJianyingDraft({})
    expect(meta.provenance.length).toBeGreaterThan(0)
    const defaultedWithDetail = meta.provenance.filter((e) => e.status === 'defaulted' && e.detail)
    expect(defaultedWithDetail.length).toBeGreaterThanOrEqual(meta.warnings.length)
    for (const w of meta.warnings) {
      expect(defaultedWithDetail.some((e) => e.detail === w)).toBe(true)
    }
  })

  it.skipIf(!hasSample)('真实样例：provenance 含 unsupported 条目（特效轨等）', () => {
    const draftSample = JSON.parse(fs.readFileSync(SAMPLE, 'utf8'))
    const { meta } = parseJianyingDraft(draftSample)
    const unsupportedPaths = meta.provenance.filter((e) => e.status === 'unsupported').map((e) => e.path)
    expect(unsupportedPaths).toContain('effectTrack')
    expect(unsupportedPaths).toContain('videoEffects')
    expect(unsupportedPaths).toContain('textGlow')
  })

  it.skipIf(!hasSample)('真实样例：body.photoScale 有专属 path（不再笼统挂在 structure 下）', () => {
    const draftSample = JSON.parse(fs.readFileSync(SAMPLE, 'utf8'))
    const { meta } = parseJianyingDraft(draftSample)
    expect(meta.provenance).toContainEqual({ path: 'body.photoScale', status: 'extracted' })
  })

  // 评审 Important #1：canvas_config / duration 键完全缺失时，回退值 720x960 / 0
  // 恰好"看起来标准"，之前会被误判成 extracted。残缺草稿应该被记成 defaulted。
  describe('硬编码默认值不能冒充 extracted（评审 Important #1）', () => {
    it('{} 输入：canvas 记为 defaulted（不带 detail，不产生新 warning）', () => {
      const { meta } = parseJianyingDraft({})
      expect(meta.provenance).toContainEqual({ path: 'canvas', status: 'defaulted' })
      expect(meta.provenance.find((e) => e.path === 'canvas' && e.status === 'extracted')).toBeUndefined()
    })

    it('{} 输入：durationMs 记为 defaulted（不带 detail，不产生新 warning）', () => {
      const { meta } = parseJianyingDraft({})
      expect(meta.provenance).toContainEqual({ path: 'durationMs', status: 'defaulted' })
      expect(meta.provenance.find((e) => e.path === 'durationMs' && e.status === 'extracted')).toBeUndefined()
    })

    it('canvas_config 只给 width、没给 height，拼出来非标准尺寸 → 仍走原有告警分支（不是"键缺失"分支）', () => {
      // 这组夹具专门用来防止"判据顺序颠倒"的回归：曾经把这种情况误判成"键不全→静默 defaulted"，
      // 吞掉了改动前代码本来就会触发的这条 warning，被 __diff_old_new__ 实证脚本抓到过。
      const { meta } = parseJianyingDraft({ canvas_config: { width: 1080 }, materials: {}, tracks: [] })
      expect(meta.warnings).toContain('画布尺寸非 720x960 (1080x960)，可能影响排版比例')
      const canvas = meta.provenance.find((e) => e.path === 'canvas')
      expect(canvas).toEqual({ path: 'canvas', status: 'defaulted', detail: '画布尺寸非 720x960 (1080x960)，可能影响排版比例' })
    })

    it('canvas_config 完整且是标准尺寸 720x960 → 仍记 extracted（不能矫枉过正）', () => {
      const { meta } = parseJianyingDraft(draft) // 既有主夹具 canvas_config 就是 { width: 720, height: 960 }
      expect(meta.provenance).toContainEqual({ path: 'canvas', status: 'extracted' })
    })
  })

  // 评审 Important #2：父级整体 defaulted 时，子叶子字段不能"沉默缺席"——
  // 应该各自也留一条 defaulted 记录，且共用同一句 detail 时 warnings 不能重复。
  describe('父级 defaulted 时叶子字段各自留痕（评审 Important #2）', () => {
    it('audio 整体缺失时，bgmVolume/openGear/transitionDrop 三个叶子字段各自也有 defaulted 条目', () => {
      const { meta } = parseJianyingDraft({})
      const detail = '未找到音频轨道，BGM 音量/音效回退默认值'
      expect(meta.provenance).toEqual(expect.arrayContaining([
        { path: 'audio', status: 'defaulted', detail },
        { path: 'audio.bgmVolume', status: 'defaulted', detail },
        { path: 'audio.sfx.openGear', status: 'defaulted', detail },
        { path: 'audio.sfx.transitionDrop', status: 'defaulted', detail },
      ]))
    })

    it('开场标题段缺失时，open.titleText 与 open.durationMs 各自都有 defaulted 条目', () => {
      const { meta } = parseJianyingDraft({})
      const detail = '未找到开场标题段，回退默认标题/时长'
      expect(meta.provenance).toEqual(expect.arrayContaining([
        { path: 'open.titleText', status: 'defaulted', detail },
        { path: 'open.durationMs', status: 'defaulted', detail },
      ]))
    })

    it('书名快闪段缺失时，flash.perClipMs 与 flash.minClipMs 各自都有 defaulted 条目', () => {
      const { meta } = parseJianyingDraft({})
      const detail = '未找到书名快闪段，回退默认快闪时长'
      expect(meta.provenance).toEqual(expect.arrayContaining([
        { path: 'flash.perClipMs', status: 'defaulted', detail },
        { path: 'flash.minClipMs', status: 'defaulted', detail },
      ]))
    })

    it('正片字幕段缺失时，fontFamily/color/posY 三个叶子字段各自都有 defaulted 条目', () => {
      const { meta } = parseJianyingDraft({})
      const detail = '未找到正片字幕段，回退默认字幕样式'
      expect(meta.provenance).toEqual(expect.arrayContaining([
        { path: 'body.subtitleFontFamily', status: 'defaulted', detail },
        { path: 'body.subtitleColor', status: 'defaulted', detail },
        { path: 'body.subtitlePosY', status: 'defaulted', detail },
      ]))
    })

    it('同一句 detail 被 4 个 path（audio 及其 3 个叶子）共用时，warnings 里只出现一次', () => {
      const { meta } = parseJianyingDraft({})
      const detail = '未找到音频轨道，BGM 音量/音效回退默认值'
      expect(meta.warnings.filter((w) => w === detail)).toHaveLength(1)
      // 去重只影响 warnings，不影响 provenance 条数——4 条 provenance 记录都应该在
      expect(meta.provenance.filter((e) => e.detail === detail)).toHaveLength(4)
    })
  })

  // 回归红线：warnings 文案必须与改动前逐字节相同（web/app/admin/jianying/page.tsx 的
  // buildReport() 消费这个数组翻译成运营看的报告，文案一变报告就静默变了）。
  // 期望值是手写常量（改动前对同一夹具实际跑出来的结果，逐字节抄入，不是由被测代码算出来的）。
  describe('回归红线：warnings 文案与改动前完全一致', () => {
    it('基础夹具 draft → 无 warning', () => {
      const { meta } = parseJianyingDraft(draft)
      expect(meta.warnings).toEqual([])
    })

    it('空对象 {} → 8 条默认回退 warning，文案逐字不变', () => {
      const { meta } = parseJianyingDraft({})
      expect(meta.warnings).toEqual([
        '未从文字素材中找到书名(《...》)',
        '未找到开场标题段，回退默认标题/时长',
        '未找到动画素材(material_animations)，开场动画(破镜重圆)回退默认值',
        '未找到书名快闪段，回退默认快闪时长',
        '未找到正片字幕段，回退默认字幕样式',
        '未找到转场素材，回退默认转场时长',
        '未找到动画素材(material_animations)，Ken-Burns 回退默认值',
        '未找到音频轨道，BGM 音量/音效回退默认值',
      ])
    })

    it('null → 全默认，仅 1 条 warning', () => {
      const { meta } = parseJianyingDraft(null)
      expect(meta.warnings).toEqual(['draft 不是可解析的对象，已回退全默认参数'])
    })

    it('缺失 material_animations → 2 条 warning，文案逐字不变', () => {
      const { material_animations: _omit, ...restMaterials } = draft.materials as Record<string, unknown>
      const d = { ...draft, materials: restMaterials }
      const { meta } = parseJianyingDraft(d)
      expect(meta.warnings).toEqual([
        '未找到动画素材(material_animations)，开场动画(破镜重圆)回退默认值',
        '未找到动画素材(material_animations)，Ken-Burns 回退默认值',
      ])
    })

    it.skipIf(!hasSample)('真实样例 → 无 warning（样例数据完整，全部真提取）', () => {
      const draftSample = JSON.parse(fs.readFileSync(SAMPLE, 'utf8'))
      const { meta } = parseJianyingDraft(draftSample)
      expect(meta.warnings).toEqual([])
    })
  })
})
