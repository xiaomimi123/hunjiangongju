// 按草稿的正片时长与实测语速推导文案字数上限。
//
// 为什么需要：剪映导入时从不写 maxLines/maxTotalChars，生成时走代码默认值 **220 字**。
// 而客户样例的正片总时长只有 20.6 秒——220 字等于要以 10.7 字/秒念完，是原片实测语速
// （4.7 字/秒）的两倍多。给 AI 的预算是它该有的 2.3 倍，AI 按预算写满，于是文案长得离谱，
// 还被迫靠复述原著情节来填字数。
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
 * 按正片总时长 × 语速推字数上限。
 * @param bodyDurationMs 正片段总时长
 * @param segCount 段数（= 图片槽位数）
 * @param speechRate 实测语速；缺省用通用常数 CHARS_PER_SEC
 * @returns null 表示时长非法，调用方不应写该字段（维持现状默认）
 */
export function deriveDraftCharBudget(
  bodyDurationMs: number,
  segCount: number,
  speechRate?: number,
): { maxLines: number; maxTotalChars: number } | null {
  if (!Number.isFinite(bodyDurationMs) || bodyDurationMs <= 0) return null
  const rate = typeof speechRate === 'number' && Number.isFinite(speechRate) ? speechRate : CHARS_PER_SEC
  const seg = Math.max(1, Math.floor(segCount) || 1)

  const byDuration = Math.round((bodyDurationMs / 1000) * rate)
  const floor = seg * MIN_CHARS_PER_SEG
  const maxTotalChars = Math.max(floor, byDuration)

  // 行数上限不能低于段数——否则「必须恰好 N 段」与「最多 M 行」自相矛盾，
  // 会让 validateScript 永远判超限、白白重试三次再兜底裁剪。
  const maxLines = Math.max(seg, Math.ceil(maxTotalChars / 12))
  return { maxLines, maxTotalChars }
}
