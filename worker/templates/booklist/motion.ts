// 运镜库 + 转场库。全部产出字面量 GSAP tween 字符串（seek-safe，无 function-based 值）。
import { sec } from './util'

export type MoveId = 'push-in' | 'pull-back' | 'pan-right' | 'pan-left' | 'drift-up' | 'tilt-settle'
export const MOVES: MoveId[] = ['push-in', 'pull-back', 'pan-right', 'pan-left', 'drift-up', 'tilt-settle']

export function pickMove(seqNo: number, offset: number): MoveId {
  return MOVES[(((seqNo + offset) % MOVES.length) + MOVES.length) % MOVES.length]
}

/**
 * 场景运镜：对 .sN .photo 施加跨整段时间窗的缓慢位移/缩放。
 * pushDur 比段长多 1.2s，保证段末仍在运动（避免定格死板）。所有值字面量。
 * .photo 有 inset:-30px 余量，横摇/上移的 ±24px 不会露底。
 */
export function moveTweens(move: MoveId, n: number, startMs: number, endMs: number, isLast: boolean): string {
  const startSec = sec(startMs)
  const segLenSec = Math.max(0.1, sec(endMs - startMs))
  const dur = Math.round((segLenSec + 1.2) * 1000) / 1000
  const sel = `'.s${n} .photo'`
  const t = (from: string, to: string) =>
    `  tl.fromTo(${sel}, ${from}, { ${to}, duration: ${dur}, ease: 'sine.inOut' }, ${startSec});`
  const pushTo = isLast ? 1.16 : 1.105
  switch (move) {
    case 'push-in':
      return t(`{ scale: 1.035 }`, `scale: ${pushTo}`)
    case 'pull-back':
      return t(`{ scale: ${isLast ? 1.2 : 1.14} }`, `scale: 1.04`)
    case 'pan-right':
      return t(`{ scale: 1.1, x: -24 }`, `x: 24`)
    case 'pan-left':
      return t(`{ scale: 1.1, x: 24 }`, `x: -24`)
    case 'drift-up':
      return t(`{ scale: 1.1, y: 24 }`, `y: -24`)
    case 'tilt-settle':
      return t(`{ scale: 1.12, rotation: -2 }`, `scale: 1.06, rotation: 0`)
  }
}

/** 字幕首拍咬合：段起拍处对 .sN .photo 叠 0.12s scale 微脉冲，制造节奏重音。 */
export function beatAccent(n: number, atMs: number): string {
  const at = sec(atMs)
  return (
    `  tl.to('.s${n} .photo', { scale: '+=0.012', duration: 0.12, ease: 'power2.out', yoyo: true, repeat: 1 }, ${at});`
  )
}
