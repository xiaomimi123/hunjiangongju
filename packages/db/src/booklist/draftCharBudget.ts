// 按草稿的正片时长推导文案字数上限。
//
// 为什么需要：剪映导入时从不写 maxLines/maxTotalChars，生成时走代码默认值 **220 字**。
// 而客户样例的正片总时长只有 20.6 秒——220 字等于要以 10.7 字/秒念完，文案长得离谱。
//
// ── 用谁的语速？（第一版在这里搞错了）──
//
// 第一版用**草稿实测的语速**（原作者约 4.3 字/秒）算预算，得到 89 字。
// 但那回答的是「原作者在这个时长里写了多少字」，而我们要问的是
// 「**我们的配音**要多少字才能填满这个时长」——两者不是一回事。
// 我们的 TTS 快得多：线上实测 99 字念了 16.15 秒 = 6.1 字/秒，与 CHARS_PER_SEC 基本吻合。
// 于是 89 字只念 14 秒，24.6 秒的模板出来的片子只有 16 秒。
//
// 所以预算一律按 **CHARS_PER_SEC（我们自己的语速）** 算。草稿实测语速仍然有用，
// 但它属于保真度报告的范畴（说明原片的疏密），不该拿来定预算。
//
// 段数强约束（fitSegments）只管「分成几段」，不管总字数——8 段合并成 4 段，总字数一个字
// 没少，反而每段更长。两者必须配合：段数锁定形状，字数上限锁定体量。

import { CHARS_PER_SEC } from '../pipeline'

/** 语速合理区间（字/秒）。超出视为脏数据，宁可回退通用常数也不用它污染预算。 */
const MIN_RATE = 2
const MAX_RATE = 12
/** 每段至少留这么多字，否则极短模板会算出「每段 3 个字」这种没法用的预算 */
const MIN_CHARS_PER_SEG = 6

export interface DraftTextSample {
  text: string
  durationMs: number
}

/** 成片时长硬上限（秒）。超过这个长度的片子不适合投放，宁可裁文案也不让它超。 */
export const MAX_VIDEO_SEC = 30

/**
 * 从草稿的正文文字层实测语速（字/秒）。
 * 样本不足、时长为零、或算出的语速离谱 → null，调用方回退通用常数。
 */
export function deriveDraftSpeechRate(samples: DraftTextSample[]): number | null {
  if (!Array.isArray(samples) || samples.length === 0) return null
  let chars = 0
  let ms = 0
  for (const s of samples) {
    const t = typeof s?.text === 'string' ? s.text.trim() : ''
    const d = typeof s?.durationMs === 'number' && Number.isFinite(s.durationMs) ? s.durationMs : 0
    if (!t || d <= 0) continue
    chars += Array.from(t).length
    ms += d
  }
  if (chars === 0 || ms <= 0) return null
  const rate = chars / (ms / 1000)
  if (!Number.isFinite(rate) || rate < MIN_RATE || rate > MAX_RATE) return null
  return rate
}

/**
 * 按正片总时长推字数上限。
 *
 * @param bodyDurationMs 正片段总时长
 * @param segCount 段数（= 图片槽位数）
 * @param nonBodyDurationMs 开场 + 快闪的时长，用来算 30 秒硬上限还能留给正片多少
 * @returns null 表示时长非法，调用方不应写该字段（维持现状默认）
 *
 * 产出两个数：
 * - `maxTotalChars` **软预算**：告诉 AI 的目标，按模板时长算，让成片长度贴近原片。
 * - `hardCapChars` **硬上限**：只有超过它才裁剪。软预算超一点不裁——
 *   裁剪是从尾部整行丢弃，丢掉的正是收尾句，听感上就是「话没说完就结束了」。
 */
export function deriveDraftCharBudget(
  bodyDurationMs: number,
  segCount: number,
  nonBodyDurationMs = 0,
): { maxLines: number; maxTotalChars: number; hardCapChars: number } | null {
  if (!Number.isFinite(bodyDurationMs) || bodyDurationMs <= 0) return null
  const seg = Math.max(1, Math.floor(segCount) || 1)

  const byDuration = Math.round((bodyDurationMs / 1000) * CHARS_PER_SEC)
  const floor = seg * MIN_CHARS_PER_SEG
  const maxTotalChars = Math.max(floor, byDuration)

  // 硬上限：30 秒减去开场+快闪，剩下的时间按我们的语速能念多少字。
  // 非法/缺省的 nonBody 视为 0，此时上限就是「整整 30 秒都用来念正文」。
  const nonBodySec = Number.isFinite(nonBodyDurationMs) && nonBodyDurationMs > 0 ? nonBodyDurationMs / 1000 : 0
  const capBySec = Math.round(Math.max(0, MAX_VIDEO_SEC - nonBodySec) * CHARS_PER_SEC)
  // 硬上限不得低于软预算，否则 AI 刚好写到目标就被裁
  const hardCapChars = Math.max(maxTotalChars, capBySec)

  // 行数上限不能低于段数——否则「必须恰好 N 段」与「最多 M 行」自相矛盾，
  // 会让 validateScript 永远判超限、白白重试三次再兜底裁剪。
  const maxLines = Math.max(seg, Math.ceil(hardCapChars / 12))
  return { maxLines, maxTotalChars, hardCapChars }
}
