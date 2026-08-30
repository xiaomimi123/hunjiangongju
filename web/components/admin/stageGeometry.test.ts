import { describe, it, expect } from 'vitest'
import { DEFAULT_PARAMS } from '@mixcut/db'
import {
  fitSizePx,
  computeStageLayers,
  captionZhTop,
  captionEnTop,
  captionEnFontSizePx,
  bookTitleTop,
  bookTitleFontSizePx,
  flashTitleTop,
  flashTitleBaseSizePx,
  flashTitleFontSizePx,
  flashAuthorTop,
  flashAuthorFontSizePx,
  openTitleTop,
  openTitleFontSizePx,
  nextPosY,
  nextCaptionSizePx,
  nextLayerScale,
  type StageGeometryInput,
  type StageSample,
  type CaptionGeom,
  type CenterTextGeom,
  type FlashAuthorGeom,
} from './stageGeometry'
import type { TextParams } from './paramControls'

// DEFAULT_PARAMS.text 与 web 的 TextParams 结构完全一致（packages/db/src/booklist/
// templateParams.ts 的 text 字段本就是 TextParams 加 bookTitlePosY/flashTitlePosY/
// openTitlePosY 三个 posY —— 这三个字段现在也补进了 TextParams，见 paramControls.tsx）。
const TEXT: TextParams = { ...DEFAULT_PARAMS.text! }

const SAMPLE: StageSample = {
  caption: '这是一句字幕',
  captionEn: 'This is a caption',
  bookTitle: '活着',
  bookAuthor: '余华',
  openTitle: '今天分享的是',
  watermark: '@东方文澜',
}

function input(patch: Partial<StageGeometryInput> = {}): StageGeometryInput {
  return {
    width: 720,
    height: 1280,
    scene: 'body',
    text: TEXT,
    captionPosY: 0.78,
    sample: SAMPLE,
    ...patch,
  }
}

describe('坐标 1:1，零换算', () => {
  it('height=960, bookTitlePosY=0.25 → top 恰好 240（不是缩放后的值）', () => {
    expect(bookTitleTop(960, 0.25)).toBe(240)
  })

  it('computeStageLayers 里的 bookTitle.top 同样是真实像素', () => {
    const layers = computeStageLayers(input({ height: 960, text: { ...TEXT, bookTitlePosY: 0.25 } }))
    const bt = layers.find((l) => l.layer === 'bookTitle') as CenterTextGeom
    expect(bt.top).toBe(240)
  })
})

describe('长书名走 fitSizePx（与成片同一份函数）', () => {
  it('bookTitle 字号 = fitSizePx(《长书名》, round(captionSizePx*bookTitleScale)*bookTitleBoost, width)', () => {
    const long = '我们生活在巨大的差距里'
    const layers = computeStageLayers(input({ sample: { ...SAMPLE, bookTitle: long } }))
    const bt = layers.find((l) => l.layer === 'bookTitle') as CenterTextGeom
    const base = Math.round(Math.round(TEXT.captionSizePx * TEXT.bookTitleScale) * TEXT.bookTitleBoost)
    const expected = fitSizePx(`《${long}》`, base, 720)
    expect(bt.fontSizePx).toBe(expected)
    expect(bt.text).toBe(`《${long}》`)
  })

  it('flashTitle 字号同样走 fitSizePx', () => {
    const long = '我们生活在巨大的差距里'
    const layers = computeStageLayers(input({ scene: 'flash', sample: { ...SAMPLE, bookTitle: long } }))
    const ft = layers.find((l) => l.layer === 'flashTitle') as CenterTextGeom
    const expected = fitSizePx(`《${long}》`, flashTitleBaseSizePx(TEXT), 720)
    expect(ft.fontSizePx).toBe(expected)
  })

  it('短书名不缩，等于基准字号（对照组，确认没有误用 fitSizePx 把短标题也缩了）', () => {
    const layers = computeStageLayers(input({ sample: { ...SAMPLE, bookTitle: '短' } }))
    const bt = layers.find((l) => l.layer === 'bookTitle') as CenterTextGeom
    const base = Math.round(Math.round(TEXT.captionSizePx * TEXT.bookTitleScale) * TEXT.bookTitleBoost)
    expect(bt.fontSizePx).toBe(base)
  })
})

describe('★ 双语时中文行不能位移', () => {
  it('开/关双语时 caption 中文行 top 完全相同', () => {
    const off = computeStageLayers(input({ text: { ...TEXT, bilingual: false } }))
    const on = computeStageLayers(input({ text: { ...TEXT, bilingual: true } }))
    const capOff = off.find((l) => l.layer === 'caption') as CaptionGeom
    const capOn = on.find((l) => l.layer === 'caption') as CaptionGeom
    expect(capOn.zh.top).toBe(capOff.zh.top)
    expect(capOn.zh.fontSizePx).toBe(capOff.zh.fontSizePx)
    expect(capOff.zh.top).toBe(captionZhTop(1280, 0.78))
  })

  it('关闭双语时不产出英文行', () => {
    const layers = computeStageLayers(input({ text: { ...TEXT, bilingual: false } }))
    const cap = layers.find((l) => l.layer === 'caption') as CaptionGeom
    expect(cap.en).toBeUndefined()
  })

  it('开启双语但没有英文样本文本时同样不产出英文行', () => {
    const layers = computeStageLayers(
      input({ text: { ...TEXT, bilingual: true }, sample: { ...SAMPLE, captionEn: undefined } }),
    )
    const cap = layers.find((l) => l.layer === 'caption') as CaptionGeom
    expect(cap.en).toBeUndefined()
  })

  it('英文行 top = round(height*captionPosY) + enGapPx', () => {
    const layers = computeStageLayers(input({ text: { ...TEXT, bilingual: true, enGapPx: 12 }, captionPosY: 0.777 }))
    const cap = layers.find((l) => l.layer === 'caption') as CaptionGeom
    expect(cap.en!.top).toBe(Math.round(1280 * 0.777) + 12)
    expect(cap.en!.top).toBe(captionEnTop(1280, 0.777, 12))
  })

  it('英文行字号 = round(captionSizePx * enScale)', () => {
    const layers = computeStageLayers(input({ text: { ...TEXT, bilingual: true, enScale: 0.5 } }))
    const cap = layers.find((l) => l.layer === 'caption') as CaptionGeom
    expect(cap.en!.fontSizePx).toBe(Math.round(TEXT.captionSizePx * 0.5))
    expect(cap.en!.fontSizePx).toBe(captionEnFontSizePx({ ...TEXT, enScale: 0.5 }))
  })
})

describe('场景切换：各场景只产出该场景的图层', () => {
  it('open 场景只有 openTitle，没有 caption / bookTitle / flashTitle / watermark', () => {
    const layers = computeStageLayers(input({ scene: 'open' }))
    expect(layers.map((l) => l.layer)).toEqual(['openTitle'])
  })

  it('flash 场景只有 flashTitle + flashAuthor，没有 caption / bookTitle / openTitle', () => {
    const layers = computeStageLayers(input({ scene: 'flash' }))
    expect(layers.map((l) => l.layer).sort()).toEqual(['flashAuthor', 'flashTitle'])
  })

  it('body 场景有 bookTitle + caption + watermark，没有 openTitle / flashTitle', () => {
    const layers = computeStageLayers(input({ scene: 'body' }))
    expect(layers.map((l) => l.layer).sort()).toEqual(['bookTitle', 'caption', 'watermark'])
  })

  it('body 场景没有书名样本时不产出 bookTitle 层', () => {
    const layers = computeStageLayers(input({ scene: 'body', sample: { ...SAMPLE, bookTitle: undefined } }))
    expect(layers.some((l) => l.layer === 'bookTitle')).toBe(false)
  })

  it('body 场景没有水印样本时不产出 watermark 层', () => {
    const layers = computeStageLayers(input({ scene: 'body', sample: { ...SAMPLE, watermark: undefined } }))
    expect(layers.some((l) => l.layer === 'watermark')).toBe(false)
  })

  it('flash 场景没有作者样本时不产出 flashAuthor 层（与 ass.ts 只在 author 非空时画 fa 事件一致）', () => {
    const layers = computeStageLayers(input({ scene: 'flash', sample: { ...SAMPLE, bookAuthor: undefined } }))
    expect(layers.map((l) => l.layer)).toEqual(['flashTitle'])
  })
})

describe('快闪作者：top 与字号系数', () => {
  it('top = flashTitle.top + flashTitleBaseSizePx（配置字号，不是 fitSizePx 缩排后的显示字号）× 0.95', () => {
    const long = '我们生活在巨大的差距里' // 触发 fitSizePx 缩排，用来验证 fay 不受缩排影响
    const layers = computeStageLayers(input({ scene: 'flash', sample: { ...SAMPLE, bookTitle: long } }))
    const ft = layers.find((l) => l.layer === 'flashTitle') as CenterTextGeom
    const fa = layers.find((l) => l.layer === 'flashAuthor') as FlashAuthorGeom
    const expectedTop = Math.round(ft.top + flashTitleBaseSizePx(TEXT) * 0.95)
    expect(fa.top).toBe(expectedTop)
    expect(fa.top).toBe(flashAuthorTop(ft.top, TEXT))
    // 缩排确实发生了（否则这条用例没测到该分支）
    expect(ft.fontSizePx).toBeLessThan(flashTitleBaseSizePx(TEXT))
  })

  it('字号 = round(captionSizePx * flashTitleScale * 0.48) —— 来自 fromBodyData.ts 的 FS.flashAuthorRatio，' +
    '不是 ass.ts 的 TITLE_SUB_RATIO=0.42（那个用于常驻大标题自己的作者副行，是另一层，见 stageGeometry.ts 里的注释）', () => {
    const layers = computeStageLayers(input({ scene: 'flash' }))
    const fa = layers.find((l) => l.layer === 'flashAuthor') as FlashAuthorGeom
    expect(fa.fontSizePx).toBe(Math.round(TEXT.captionSizePx * TEXT.flashTitleScale * 0.48))
    expect(fa.fontSizePx).toBe(flashAuthorFontSizePx(TEXT))
  })
})

describe('开场标题', () => {
  it('top = height * openTitlePosY，字号 = round(captionSizePx * openTitleScale)', () => {
    const layers = computeStageLayers(input({ scene: 'open', height: 1280 }))
    const ot = layers.find((l) => l.layer === 'openTitle') as CenterTextGeom
    expect(ot.top).toBe(openTitleTop(1280, TEXT.openTitlePosY))
    expect(ot.top).toBe(1280 * TEXT.openTitlePosY)
    expect(ot.fontSizePx).toBe(openTitleFontSizePx(TEXT))
    expect(ot.fontSizePx).toBe(Math.round(TEXT.captionSizePx * TEXT.openTitleScale))
  })

  it('open 场景没有开场白样本时不产出 openTitle 层', () => {
    const layers = computeStageLayers(input({ scene: 'open', sample: { ...SAMPLE, openTitle: undefined } }))
    expect(layers).toEqual([])
  })
})

describe('水印：固定小字号、半透明、右上角', () => {
  it('geometry 固定为 top/right=24, fontSizePx=22, opacity=0.62', () => {
    const layers = computeStageLayers(input({ scene: 'body' }))
    const wm = layers.find((l) => l.layer === 'watermark') as { top: number; right: number; fontSizePx: number; opacity: number }
    expect(wm.top).toBe(24)
    expect(wm.right).toBe(24)
    expect(wm.fontSizePx).toBe(22)
    expect(wm.opacity).toBe(0.62)
  })
})

describe('拖拽换算：nextPosY', () => {
  it('scale=1 时，deltaClientY 换回真实像素后除以 height 就是位移量', () => {
    // startPosY=0.5, height=1280, delta=64 -> +64/1280
    expect(nextPosY(0.5, 64, 1, 1280)).toBeCloseTo(0.5 + 64 / 1280, 10)
  })

  it('★ scale 必须参与换算：scale=2 时同样的 deltaClientY 只产生一半的位移', () => {
    const full = nextPosY(0.5, 64, 1, 1280) - 0.5
    const half = nextPosY(0.5, 64, 2, 1280) - 0.5
    expect(half).toBeCloseTo(full / 2, 10)
  })

  it('往上拖过头夹到 0', () => {
    expect(nextPosY(0.1, -9999, 1, 1280)).toBe(0)
  })

  it('往下拖过头夹到 1', () => {
    expect(nextPosY(0.9, 9999, 1, 1280)).toBe(1)
  })
})

describe('拖把手改字号：caption 层 nextCaptionSizePx', () => {
  it('scale=1 时直接是像素加减', () => {
    expect(nextCaptionSizePx(54, 10, 1)).toBe(64)
  })

  it('★ 受 scale 影响：scale=2 时同样的 deltaClientY 只产生一半的像素变化', () => {
    expect(nextCaptionSizePx(54, 10, 2)).toBe(59)
  })

  it('夹在 [20, 120]（与 paramControls.tsx「正文字号（锚点）」及 paramsWhitelist.ts 一致）', () => {
    expect(nextCaptionSizePx(54, -9999, 1)).toBe(20)
    expect(nextCaptionSizePx(54, 9999, 1)).toBe(120)
  })
})

describe('拖把手改字号：其余层 nextLayerScale', () => {
  it('scale=1 时按 captionSizePx 折算倍数变化量', () => {
    // startScale=1.85, delta=27, captionSizePx=54 -> +0.5
    expect(nextLayerScale(1.85, 27, 1, 54)).toBeCloseTo(1.85 + 0.5, 10)
  })

  it('★ 受 scale 影响：scale=2 时同样的 deltaClientY 只产生一半的倍数变化', () => {
    const full = nextLayerScale(1.85, 27, 1, 54) - 1.85
    const half = nextLayerScale(1.85, 27, 2, 54) - 1.85
    expect(half).toBeCloseTo(full / 2, 10)
  })

  it('夹在 [0.2, 5]（与 paramControls.tsx 书名/快闪书名/开场标题倍数输入框及 paramsWhitelist.ts 一致）', () => {
    expect(nextLayerScale(1.85, -9999, 1, 54)).toBe(0.2)
    expect(nextLayerScale(1.85, 9999, 1, 54)).toBe(5)
  })
})
