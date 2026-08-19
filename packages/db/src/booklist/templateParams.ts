// booklist 模板参数：结构/节奏/转场/字幕/快闪/音效。默认值=从客户剪映工程解出的配方。
// P2 学习器将产出同结构对象填 framework.overlayTemplate.__templateParams。

import type { MoveId } from './draftMotion'

export type TemplateMode = 'classic' | 'flash'

export interface GradeParams { filterName: string; intensity: number; contrast: number; sharpen: boolean }

export interface TemplateParams {
  mode: TemplateMode
  open: { durationMs: number; shatter: boolean; titleText: string; sfx: boolean }
  // hardCut：快闪卡之间瞬时切换、不做淡入。可选字段，缺省即维持既有的 0.12s 淡入，老框架零回归。
  // 依据是草稿的快闪段边界上有无转场素材（实测原工程是硬切，而我们一直在加淡入）。
  flash: { perClipMs: number; minClipMs: number; bounceIn: boolean; titleFontFamily: string; scale?: number; hardCut?: boolean }
  transition: { type: 'dissolve'; durationMs: number }
  body: { subtitleFontFamily: string; subtitleColor: string; subtitlePosY: number; kenBurns: 'subtle' | 'off'; photoScale?: number; subtitleEntrance?: string }
  audio: { bgmVolume: number; sfx: { openGear: boolean; transitionDrop: boolean } }
  grade?: GradeParams
  motion?: { moves: MoveId[] }
}

export const DEFAULT_PARAMS: TemplateParams = {
  mode: 'classic',
  open: { durationMs: 2160, shatter: true, titleText: '今天分享的是', sfx: true },
  flash: { perClipMs: 200, minClipMs: 120, bounceIn: true, titleFontFamily: 'flash-title' },
  transition: { type: 'dissolve', durationMs: 400 },
  body: { subtitleFontFamily: 'subtitle', subtitleColor: '#ffffff', subtitlePosY: 0.78, kenBurns: 'subtle' },
  audio: { bgmVolume: 0.69, sfx: { openGear: true, transitionDrop: true } },
}

function obj(x: unknown): Record<string, unknown> {
  return x && typeof x === 'object' && !Array.isArray(x) ? (x as Record<string, unknown>) : {}
}
function num(v: unknown, d: number): number { return typeof v === 'number' && Number.isFinite(v) ? v : d }
function str(v: unknown, d: string): string { return typeof v === 'string' && v.trim() ? v : d }
function bool(v: unknown, d: boolean): boolean { return typeof v === 'boolean' ? v : d }

export function parseTemplateParams(raw: unknown): TemplateParams {
  const r = obj(raw)
  const D = DEFAULT_PARAMS
  const open = obj(r.open), flash = obj(r.flash), tr = obj(r.transition), body = obj(r.body)
  const audio = obj(r.audio), sfx = obj(audio.sfx)
  return {
    mode: r.mode === 'flash' ? 'flash' : 'classic',
    open: {
      durationMs: num(open.durationMs, D.open.durationMs),
      shatter: bool(open.shatter, D.open.shatter),
      titleText: str(open.titleText, D.open.titleText),
      sfx: bool(open.sfx, D.open.sfx),
    },
    flash: {
      perClipMs: num(flash.perClipMs, D.flash.perClipMs),
      minClipMs: num(flash.minClipMs, D.flash.minClipMs),
      bounceIn: bool(flash.bounceIn, D.flash.bounceIn),
      titleFontFamily: str(flash.titleFontFamily, D.flash.titleFontFamily),
      ...(typeof flash.scale === 'number' && Number.isFinite(flash.scale) ? { scale: flash.scale } : {}),
      ...(typeof flash.hardCut === 'boolean' ? { hardCut: flash.hardCut } : {}),
    },
    transition: { type: 'dissolve', durationMs: num(tr.durationMs, D.transition.durationMs) },
    body: {
      subtitleFontFamily: str(body.subtitleFontFamily, D.body.subtitleFontFamily),
      subtitleColor: str(body.subtitleColor, D.body.subtitleColor),
      subtitlePosY: num(body.subtitlePosY, D.body.subtitlePosY),
      kenBurns: body.kenBurns === 'off' ? 'off' : 'subtle',
      ...(typeof body.photoScale === 'number' && Number.isFinite(body.photoScale) ? { photoScale: body.photoScale } : {}),
      ...(typeof body.subtitleEntrance === 'string' && body.subtitleEntrance ? { subtitleEntrance: body.subtitleEntrance } : {}),
    },
    audio: {
      bgmVolume: num(audio.bgmVolume, D.audio.bgmVolume),
      sfx: { openGear: bool(sfx.openGear, D.audio.sfx.openGear), transitionDrop: bool(sfx.transitionDrop, D.audio.sfx.transitionDrop) },
    },
    ...(r.grade && typeof r.grade === 'object' && !Array.isArray(r.grade)
      ? { grade: {
          filterName: str((r.grade as Record<string, unknown>).filterName, ''),
          intensity: num((r.grade as Record<string, unknown>).intensity, 0),
          contrast: num((r.grade as Record<string, unknown>).contrast, 0),
          sharpen: bool((r.grade as Record<string, unknown>).sharpen, false),
        } }
      : {}),
    ...(Array.isArray(obj(r.motion).moves)
      ? { motion: { moves: (obj(r.motion).moves as unknown[]).filter((x): x is string => typeof x === 'string' && !!x) as MoveId[] } }
      : {}),
  }
}

export interface FlashTimeline { openEndMs: number; flashEndMs: number; perClipMs: number; count: number }

// 快闪落在第 0 段时间窗内：开场 [0,openEndMs] + 快闪 [openEndMs,seg0EndMs] 均分 N 本。
export function flashTimeline(p: TemplateParams, seg0EndMs: number, bookCount: number): FlashTimeline {
  const openEndMs = Math.round(Math.min(p.open.durationMs, seg0EndMs * 0.55))
  const count = Math.max(0, bookCount)
  if (count === 0) return { openEndMs, flashEndMs: seg0EndMs, perClipMs: 0, count: 0 }
  const win = Math.max(0, seg0EndMs - openEndMs)
  const perClipMs = Math.max(p.flash.minClipMs, win / count)
  return { openEndMs, flashEndMs: seg0EndMs, perClipMs, count }
}
