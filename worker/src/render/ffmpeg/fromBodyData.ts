// BodyData → RenderFullOpts 的映射。
//
// 这是新旧两个渲染器的**唯一接缝**。两边消费同一份 BodyData，所以灰度切换才切得动；
// 一旦这里开始「顺手补点数据」，两条路径就会悄悄分叉，切回去时画面对不上。
//
// 纯函数：不碰文件系统。IO（拷图、渲开场、跑 ffmpeg）留在 renderVisuals 里。

import type { BodyData, BodySegment } from '../../../templates/booklist/bodyData'
import { flashTimeline } from '../../../templates/booklist/templateParams'
import { distributeCards } from './flash'
import type { RenderFullOpts, FullFlashCard } from './renderFull'
import type { RenderBodySegment } from './renderBody'
import { DEFAULT_FONT_NAME, FONTS_DIR } from './fonts'
import { selectPreset, hasGrain } from '../../../templates/booklist/theme'

export interface FromBodyDataIo {
  /** hf 工作目录的绝对路径；images/covers 的相对路径以它为基准 */
  hfDir: string
  /** 渲好的开场碎裂片段；缺省则整片从快闪开始 */
  openingClipAbs?: string
  ripple?: { xmapAbs: string; ymapAbs: string }
  assAbs: string
  outAbs: string
}

/** 相对路径 → 绝对路径。BodyData 里存的是 hf 目录内的相对路径（media/01.png） */
function abs(hfDir: string, rel: string): string {
  return rel.startsWith('/') ? rel : `${hfDir}/${rel}`
}

/**
 * 字幕/标题的字号。
 *
 * HyperFrames 那边字号来自 CSS 变量（--fs-cap-zh 等），是随预设走的；
 * ffmpeg 这边必须给具体像素值。**这是两条路径无法完全等同的一处**——
 * CSS 的 rem/vw 与 ASS 的绝对像素没有可逆换算，只能按 720×960 标定一组经验值。
 * 差异会体现在字号上，不会体现在时序或位置上。
 */
const FS = { caption: 46, title: 50, watermark: 22, flashTitle: 58, flashAuthor: 26 }

export function fromBodyData(data: BodyData, io: FromBodyDataIo): RenderFullOpts {
  const p = data.templateParams
  const segs = [...data.segments].sort((a, b) => a.startMs - b.startMs)
  const imgAbs = (s: BodySegment, i: number) =>
    abs(io.hfDir, data.images[s.imageIndex]?.src ?? data.images[i]?.src ?? '')

  // 第 0 段是「开场 + 快闪」那个时间窗，第 1..N 段才是正片——与 HyperFrames 分支同一套划分
  const covers = data.flashCovers ?? []
  const t = p ? flashTimeline(p, segs[0]?.endMs ?? 0, covers.length) : null

  const flashCards: FullFlashCard[] = []
  if (t && covers.length > 0) {
    // 逐卡时长优先用草稿实测比例（templateParams.flash.clipMs），否则等分
    const slots = distributeCards(covers.length, Math.max(0, t.flashEndMs - t.openEndMs), p?.flash.clipMs)
    covers.forEach((c, i) => {
      const s = slots[i]
      if (!s) return
      flashCards.push({
        coverAbs: abs(io.hfDir, c.coverSrc),
        title: c.title,
        ...(c.author ? { author: c.author } : {}),
        startMs: t.openEndMs + s.startMs,
        endMs: t.openEndMs + s.endMs,
      })
    })
  }

  const bodySegments: RenderBodySegment[] = segs.slice(1).map((s, i) => ({
    imageAbs: imgAbs(s, i + 1),
    startMs: s.startMs,
    endMs: s.endMs,
    ...(s.bookTitle ? { bookTitle: s.bookTitle } : {}),
    ...(s.bookAuthor ? { bookAuthor: s.bookAuthor } : {}),
    ...(s.subtitle ? { subtitle: s.subtitle } : {}),
    ...(s.captionBeats?.length
      ? { captionBeats: s.captionBeats.map((b) => ({ zh: b.zh, startMs: b.startMs, endMs: b.endMs })) }
      : {}),
  }))

  const g = p?.grade
  // 开场底图 = 正片第 1 张（与 HyperFrames 分支同一张）。
  // 有碎裂开场片段时它用不上；没有时靠它补住开场那一段，否则成片会短掉整个开场时长。
  const openStillAbs = abs(io.hfDir, data.images[0]?.src ?? '')

  return {
    ...(io.openingClipAbs ? { openingClipAbs: io.openingClipAbs } : { openStillAbs }),
    flashCards,
    bodySegments,
    width: data.size.width,
    height: data.size.height,
    fps: 30,
    ...(p?.motion?.keyframes?.length ? { keyframes: p.motion.keyframes } : {}),
    ...(p?.transition.bodyCycle?.length ? { bodyCycle: p.transition.bodyCycle } : {}),
    flashBounceIn: p?.flash.bounceIn ?? true,
    ...(data.overlay.watermark ? { watermark: data.overlay.watermark } : {}),
    assStyle: {
      fontName: DEFAULT_FONT_NAME,
      captionColor: p?.body.subtitleColor ?? '#ffffff',
      captionPosY: p?.body.subtitlePosY ?? 0.78,
      captionSizePx: FS.caption,
      titleSizePx: FS.title,
      titleColor: '#ffe9c0',
      watermarkSizePx: FS.watermark,
      flashTitleSizePx: FS.flashTitle,
      flashTitleColor: '#ffffff',
      flashAuthorSizePx: FS.flashAuthor,
      flashAuthorColor: '#ffcc88',
    },
    decor: {
      // 与 HyperFrames 模板的 .scrim（340px 高、底部最深 0.85）对齐
      scrimHeightPx: 340,
      scrimAlpha: 0.85,
      vignette: true,
      // 颗粒开不开要走**和 HyperFrames 同一套预设解析**（selectPreset + hasGrain）。
      // 直接比对 data.style 字符串是错的：style 缺省时预设由 seed 派生，
      // 两条路径会得出不同的预设，切换渲染器时颗粒会莫名其妙地有无不定。
      grain: hasGrain(selectPreset(data.style, data.seed ?? '')),
      ...(g
        ? {
            grade: {
              ...(g.contrast ? { contrast: g.contrast } : {}),
              ...(g.intensity ? { saturation: g.intensity } : {}),
              ...(g.sharpen ? { sharpen: true } : {}),
            },
          }
        : {}),
    },
    // 水波纹：草稿实测它压在快闪→正片那一刀上；offsetMs 是相对该刀口的偏移
    ...(io.ripple && p?.effects?.ripple && t
      ? {
          ripple: {
            xmapAbs: io.ripple.xmapAbs,
            ymapAbs: io.ripple.ymapAbs,
            atMs: t.flashEndMs + p.effects.ripple.offsetMs,
            durationMs: p.effects.ripple.durationMs,
          },
        }
      : {}),
    assAbs: io.assAbs,
    outAbs: io.outAbs,
    fontsDir: FONTS_DIR,
  }
}
