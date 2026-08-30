// 剪辑参数画布的几何计算 —— 纯函数，不 import React、不碰 DOM。
//
// ★ 这块画布是**模拟器不是渲染器**，真正出片的是 worker 的 `ass.ts` + libass。
// 保真靠三条，任何一条松了这块画布就会开始骗人：
//   1. 坐标 1:1 零换算 —— 这里算出的每个数字（top / fontSizePx）就是将来存进
//      参数、喂给 ass.ts 的那个数字，单位是真实像素（如 720×960，真实值见 packages/db 的 BODY_SIZE），
//      不做任何按容器宽度的缩放。缩放只发生在 StageCanvas 的最外层 transform。
//   2. 共享 `fitSizePx` —— 长书名的缩排走 packages/db 里的那一份（下方 import），
//      与成片同一个函数，不在这里另写一遍近似算法。
//   3. 各系数逐条标注来源文件/常量名，ass.ts 改了后人才知道这里要同步改。
//
// 本文件只覆盖 ass.ts 里实际会画到「剪辑画布」上的层：正文字幕（含双语英文行）、
// 常驻《书名》大标题、快闪书名/作者、开场标题、水印。不覆盖常驻大标题自己的
// 作者副行（ass.ts 支持但当前画布任务范围未要求，见文件末尾的说明）。

// 直接从子模块导入（而非 '@mixcut/db' 包索引）：包索引（packages/db/src/index.ts）
// 会连带 re-export genQueue.ts，进而拖入 bullmq/ioredis 等仅限服务端的依赖。
// 本文件被 'use client' 的 StageCanvas.tsx 引入、打包进浏览器 bundle，
// webpack 解析不了 Node 专属模块（child_process/net/worker_threads），会导致
// 引用它的页面整页白屏（Module not found），且 `npm test`（node 环境）与
// `tsc`（只做类型解析）都测不出来——只有真的跑 next dev/build 才会暴露。
// 沿用 web/app/admin/generate/page.tsx:6-7、jianying/page.tsx、frameworks/page.tsx
// 里同样的写法与注释。
import { fitSizePx } from '@mixcut/db/src/booklist/fitSize'
import { FLASH_AUTHOR_RATIO } from '@mixcut/db/src/booklist/bodySize'
import type { TextParams } from './paramControls'

export { fitSizePx }

export type StageScene = 'open' | 'flash' | 'body'

export type StageLayer = 'caption' | 'bookTitle' | 'flashTitle' | 'flashAuthor' | 'openTitle' | 'watermark'

export type StageSample = {
  caption: string
  captionEn?: string
  bookTitle?: string
  bookAuthor?: string
  openTitle?: string
  watermark?: string
}

export interface CaptionGeom {
  layer: 'caption'
  /** 中文行：底边居中锚点（对应 ASS 的 an2），这里给的是锚点本身的 y 坐标 */
  zh: { top: number; fontSizePx: number; text: string }
  /** 双语开启且有英文文本时才有；顶边锚点（对应 an8 + \pos） */
  en?: { top: number; fontSizePx: number; text: string }
}

export interface CenterTextGeom {
  layer: 'bookTitle' | 'flashTitle' | 'openTitle'
  /** 正中锚点（对应 ASS 的 an5 + \pos），这里给的是中心点的 y 坐标 */
  top: number
  fontSizePx: number
  text: string
}

export interface FlashAuthorGeom {
  layer: 'flashAuthor'
  top: number
  fontSizePx: number
  text: string
}

export interface WatermarkGeom {
  layer: 'watermark'
  top: number
  right: number
  fontSizePx: number
  opacity: number
  text: string
}

export type StageLayerGeom = CaptionGeom | CenterTextGeom | FlashAuthorGeom | WatermarkGeom

export interface StageGeometryInput {
  width: number
  height: number
  scene: StageScene
  text: TextParams
  /** 正文字幕竖直位置，0..1（与 body.subtitlePosY / ass.ts 的 captionPosY 同口径） */
  captionPosY: number
  sample: StageSample
}

/**
 * 正文字幕中文行的锚点 y 坐标。
 *
 * ass.ts：`capMarginV = height * (1 - captionPosY)`，Style 用 an2（底边居中）+
 * MarginV=capMarginV。底边锚点在画面上的 y = height - capMarginV = height*captionPosY。
 * **这个值完全不受双语开关影响**——ass.ts 里中文行是独立的 an2 事件，双语只是
 * 另外新增一条 an8 事件，不改 MarginV。所以这里的公式里没有任何双语相关的输入。
 */
export function captionZhTop(height: number, captionPosY: number): number {
  return height * captionPosY
}

/**
 * 双语英文行的顶边锚点 y 坐标。
 *
 * 对应 ass.ts：`const enY = Math.round(o.height * st.captionPosY) + enGap`
 * （`enGap = Math.max(0, Math.round(st.enGapPx ?? 8))`），英文行用 \an8（顶边锚点）+
 * \pos(cx, enY) 精确定位，语义是"中文基线往下 enGapPx 像素"，不依赖任何行高经验系数。
 */
export function captionEnTop(height: number, captionPosY: number, enGapPx: number): number {
  return Math.round(height * captionPosY) + Math.max(0, Math.round(enGapPx))
}

/** 英文行字号：ass.ts `const enPx = Math.round(st.captionSizePx * (st.enScale ?? 0.6))` */
export function captionEnFontSizePx(text: TextParams): number {
  return Math.round(text.captionSizePx * text.enScale)
}

/**
 * 常驻《书名》大标题的锚点 y 坐标（正中，对应 an5 + \pos）。
 * ass.ts：`const ty = Math.round(o.height * (st.titlePosY ?? 0.22))`
 * （titlePosY 来自 fromBodyData.ts 的 `tx?.bookTitlePosY`）。
 */
export function bookTitleTop(height: number, bookTitlePosY: number): number {
  return height * bookTitlePosY
}

/**
 * 常驻《书名》大标题的字号：先按 fromBodyData.ts 算出配置字号，
 * 再走与成片同一份 `fitSizePx` 做长标题缩排。
 *
 * fromBodyData.ts：
 *   `titleSizePx: Math.round(px(tx?.bookTitleScale ?? 1.85) * (tx?.bookTitleBoost ?? 1.3))`
 *   其中 `px = (ratio) => Math.round(capPx * ratio)`。
 * ass.ts：`const headFs = fitSizePx(head, st.titleSizePx, o.width)`，
 *   `head` 就是 `《书名》`（bookTitleRuns 拼的第一行，不含作者）。
 */
export function bookTitleFontSizePx(text: TextParams, bookTitle: string, widthPx: number): number {
  const base = Math.round(Math.round(text.captionSizePx * text.bookTitleScale) * text.bookTitleBoost)
  return fitSizePx(`《${bookTitle}》`, base, widthPx)
}

/**
 * 快闪书名的锚点 y 坐标（正中）。
 * ass.ts：`const fty = Math.round(o.height * (st.flashTitlePosY ?? 0.5))`。
 */
export function flashTitleTop(height: number, flashTitlePosY: number): number {
  return height * flashTitlePosY
}

/** 快闪书名的**配置**字号（未经 fitSizePx 缩排）：fromBodyData.ts `flashTitleSizePx: px(tx?.flashTitleScale ?? 1.96)` */
export function flashTitleBaseSizePx(text: TextParams): number {
  return Math.round(text.captionSizePx * text.flashTitleScale)
}

/**
 * 快闪书名实际显示字号：与常驻大标题一样，走同一份 `fitSizePx` 做长标题缩排。
 * ass.ts：`const fs = fitSizePx(`《${c.title}》`, st.flashTitleSizePx ?? 58, o.width)`。
 */
export function flashTitleFontSizePx(text: TextParams, flashTitle: string, widthPx: number): number {
  return fitSizePx(`《${flashTitle}》`, flashTitleBaseSizePx(text), widthPx)
}

/**
 * 快闪作者行的锚点 y 坐标。
 *
 * ass.ts：`const fay = Math.round(fty + (st.flashTitleSizePx ?? 58) * 0.95)`——
 * ★ 注意这里用的是**配置字号**（`st.flashTitleSizePx`，即 flashTitleBaseSizePx 的结果），
 * 不是 fitSizePx 缩排之后的显示字号（`fs`，那个只用于书名自己的 `\fs` 内联标签，
 * 不参与 fay 的计算）。长书名被缩小时，作者行的位置不会跟着变。
 */
export function flashAuthorTop(flashTitleTopPx: number, text: TextParams): number {
  return Math.round(flashTitleTopPx + flashTitleBaseSizePx(text) * 0.95)
}

/**
 * 快闪作者字号。
 *
 * ★ 与 brief 草稿里写的「0.42（TITLE_SUB_RATIO）」不同——那个系数在 ass.ts 里
 * （`const TITLE_SUB_RATIO = 0.42`）实际用在**常驻大标题自己的作者副行**
 * （`subFs = Math.round(st.titleSizePx * TITLE_SUB_RATIO)`，画布本任务未覆盖
 * 这一层），不是快闪作者。快闪作者的字号是在 `worker/src/render/ffmpeg/
 * fromBodyData.ts` 里算的：
 *   `const FS = { watermark: 22, flashAuthorRatio: 0.48 }`
 *   `flashAuthorSizePx: Math.round(capPx * (tx?.flashTitleScale ?? 1.96) * FS.flashAuthorRatio)`
 * ass.ts 本身只是把这个算好的值原样塞进 Style 定义（`st.flashAuthorSizePx ?? 28`），
 * 并不在 ass.ts 内部重新计算。0.48 这个比例现从 @mixcut/db（bodySize.ts 的
 * FLASH_AUTHOR_RATIO）取，与 fromBodyData.ts 共用同一份叶子模块常量，不再各存
 * 一份字面量拷贝——改一处忘另一处会让画布悄悄偏离成片，且没有任何断言兜底。
 */
export function flashAuthorFontSizePx(text: TextParams): number {
  return Math.round(text.captionSizePx * text.flashTitleScale * FLASH_AUTHOR_RATIO)
}

/** 开场标题锚点 y 坐标（正中）。ass.ts：`const oy = Math.round(o.height * (st.openTitlePosY ?? 0.81))` */
export function openTitleTop(height: number, openTitlePosY: number): number {
  return height * openTitlePosY
}

/** 开场标题字号：fromBodyData.ts `openTitleSizePx: px(tx?.openTitleScale ?? 1.13)` */
export function openTitleFontSizePx(text: TextParams): number {
  return Math.round(text.captionSizePx * text.openTitleScale)
}

/**
 * 水印：固定小字号、半透明、右上角。
 * fromBodyData.ts：`const FS = { watermark: 22, ... }`；ass.ts 的 wm 样式颜色 alpha=96（≈0.62 不透明度）。
 */
const WATERMARK = { top: 24, right: 24, fontSizePx: 22, opacity: 0.62 }

/** 把 v 夹到 [lo, hi] 区间内，供下面几个拖拽换算函数复用。 */
function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v))
}

/**
 * 拖拽换算：纵向拖动图层 → 新的 posY（0..1，与 captionPosY / bookTitlePosY /
 * flashTitlePosY / openTitlePosY 同口径）。
 *
 * ★ 必须除以 `scale`：鼠标移动的 `deltaClientY` 是屏幕像素（CSS px），
 * 而 posY 描述的是真实像素坐标系（720×960（真实值见 packages/db 的 BODY_SIZE）这一类）里的比例。
 * `StageCanvas` 最外层用 `transform: scale(containerW / videoW)` 把真实像素
 * 画面缩小/放大铺满容器——容器越窄 scale 越小，同样的鼠标位移在真实坐标系里
 * 对应的距离就越大，所以要把 deltaClientY 先除以 scale 换回真实像素，
 * 再除以 height 换成比例。漏了这一步不会报错，只会让缩放比例一变
 * 拖拽手感就跟着变（缩得越小拖得越快），运营会觉得"这玩意儿不好用"却说不清哪里错。
 */
export function nextPosY(startPosY: number, deltaClientY: number, scale: number, height: number): number {
  return clamp(startPosY + deltaClientY / scale / height, 0, 1)
}

/**
 * 拖把手改字号 —— caption 层：直接改 `captionSizePx`（绝对像素，全片其余层字号
 * 都按它的倍数派生），区间与 paramControls.tsx「正文字号（锚点）」输入框、
 * packages/db/paramsWhitelist.ts 的夹取区间一致：[20, 120]。
 *
 * 同样要除以 `scale`，理由与 nextPosY 一致。
 */
export function nextCaptionSizePx(startPx: number, deltaClientY: number, scale: number): number {
  return clamp(startPx + deltaClientY / scale, 20, 120)
}

/**
 * 拖把手改字号 —— 其余层（bookTitle / flashTitle / openTitle，倍数相对
 * captionSizePx）：改各自的 `*Scale` 倍数。区间与 paramControls.tsx 里对应
 * 输入框（「书名标题倍数」「快闪书名倍数」「开场标题倍数」）、
 * packages/db/paramsWhitelist.ts 的夹取区间一致：[0.2, 5]。
 *
 * 除以 `scale` 换回真实像素后，再除以 `captionSizePx`——因为这些层的字号是
 * `captionSizePx * scale` 算出来的，同样的像素位移对应的「倍数」变化量
 * 要按当前锚点字号折算，锚点字号越大，拖同样的像素改变的倍数应该越小。
 */
export function nextLayerScale(startScale: number, deltaClientY: number, scale: number, captionSizePx: number): number {
  return clamp(startScale + deltaClientY / scale / captionSizePx, 0.2, 5)
}

/**
 * 按场景与素材，产出这一帧画布要画的全部图层几何。
 *
 * 场景划分（各文字层在时间上并不同时出现，全画反而失真）：
 *   - open：开场标题
 *   - flash：快闪书名 + 作者
 *   - body：常驻书名大标题 + 正文字幕（含双语英文行）+ 水印
 */
export function computeStageLayers(input: StageGeometryInput): StageLayerGeom[] {
  const { width, height, scene, text, captionPosY, sample } = input
  const out: StageLayerGeom[] = []

  if (scene === 'open' && sample.openTitle) {
    out.push({
      layer: 'openTitle',
      top: openTitleTop(height, text.openTitlePosY),
      fontSizePx: openTitleFontSizePx(text),
      text: sample.openTitle,
    })
  }

  if (scene === 'flash' && sample.bookTitle) {
    const ftTop = flashTitleTop(height, text.flashTitlePosY)
    out.push({
      layer: 'flashTitle',
      top: ftTop,
      fontSizePx: flashTitleFontSizePx(text, sample.bookTitle, width),
      text: `《${sample.bookTitle}》`,
    })
    if (sample.bookAuthor) {
      out.push({
        layer: 'flashAuthor',
        top: flashAuthorTop(ftTop, text),
        fontSizePx: flashAuthorFontSizePx(text),
        text: sample.bookAuthor,
      })
    }
  }

  if (scene === 'body') {
    if (sample.bookTitle) {
      out.push({
        layer: 'bookTitle',
        top: bookTitleTop(height, text.bookTitlePosY),
        fontSizePx: bookTitleFontSizePx(text, sample.bookTitle, width),
        text: `《${sample.bookTitle}》`,
      })
    }

    const caption: CaptionGeom = {
      layer: 'caption',
      zh: { top: captionZhTop(height, captionPosY), fontSizePx: text.captionSizePx, text: sample.caption },
    }
    if (text.bilingual && sample.captionEn) {
      caption.en = {
        top: captionEnTop(height, captionPosY, text.enGapPx),
        fontSizePx: captionEnFontSizePx(text),
        text: sample.captionEn,
      }
    }
    out.push(caption)

    if (sample.watermark) {
      out.push({ layer: 'watermark', ...WATERMARK, text: sample.watermark })
    }
  }

  return out
}
