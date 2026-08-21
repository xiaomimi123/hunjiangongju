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

/**
 * 时长过短、装不下一句话的正片段，视为**纯画面停顿**，不分配文案。
 *
 * 客户样例里正片第一段只有 781ms，字幕从 4830ms 才开始（正片 3985ms 起）——
 * 那是快闪之后的一个换气镜头，原作者本来就没在那里说话。
 * 按比例硬塞给它 4 个字，念出来是急促的半句，比留白更糟。
 */
const MIN_SPEECH_SLOT_MS = 1200

/**
 * 按草稿各正片段的时长，把总字数配额分到每一段。
 *
 * 为什么需要：字数预算原先只有**全局**一个总数，LLM 想怎么分就怎么分。
 * 实测成片正片三段是 3.6s / 4.2s / 9.4s——最后一张图挂了 9.4 秒，
 * 而草稿是 5.7 / 8.1 / 6.1。段时长是 TTS 时长累加出来的，
 * 而 TTS 时长由每段字数决定，所以要治时长得先治逐段字数。
 *
 * @param slotDurationsMs 草稿各正片段时长（含过短的纯画面段）
 * @param segCount 我们实际要生成的文案段数（未必等于草稿段数）
 * @param totalChars 总字数配额（deriveDraftCharBudget 的 maxTotalChars）
 * @returns 每段的目标字数；段数对不上时按时长比例重采样
 */
/**
 * 把草稿的正片段时长映射到**我们实际的文案段数**上。
 *
 * 两件事：
 * 1. 滤掉装不下一句话的纯画面段（见 MIN_SPEECH_SLOT_MS）
 * 2. 段数与草稿槽位数不等时按比例重采样
 *
 * **字数配额与配音补静音必须共用这一份。** 第一版没共用：配额按过滤后的列表分，
 * 补静音却按原始列表取（`slotDurationsMs[i-1]`），于是第 1 段拿到 781ms 的目标
 * 却被分了 27 个字（约 4.5 秒）——补不了静音，那一段直接超 3.7 秒。
 *
 * @returns 每段的目标时长；没有可用槽位时长时返回空数组（调用方维持原行为）
 */
export function speechSlotDurations(slotDurationsMs: number[] | undefined, segCount: number): number[] {
  const n = Math.max(1, Math.floor(segCount) || 1)
  const valid = (Array.isArray(slotDurationsMs) ? slotDurationsMs : [])
    .filter((d) => typeof d === 'number' && Number.isFinite(d) && d >= MIN_SPEECH_SLOT_MS)
  if (valid.length === 0) return []
  // 不做插值——插出来的时长没有对应的画面，还不如落在某个真实槽位上
  return Array.from({ length: n }, (_, i) =>
    valid[Math.min(valid.length - 1, Math.floor((i * valid.length) / n))])
}

export function deriveSlotCharBudgets(
  slotDurationsMs: number[],
  segCount: number,
  totalChars: number,
): number[] {
  const n = Math.max(1, Math.floor(segCount) || 1)
  const weights = speechSlotDurations(slotDurationsMs, n)
  return charBudgetsFromWeights(weights.length ? weights : new Array(n).fill(1), totalChars)
}

/**
 * 一条片子**全部**分镜槽位的目标时长，第 0 格是开场+快闪。
 *
 * ★ 这是文案字数配额与配音补静音**唯一**的槽位来源。
 *
 * 两侧共用是这个模块从一开始就写明的要求，但调用点上一直没做到：
 * 文案侧传 segCount（含开场白那一段），配音侧传 segCount-1（开场段不在正片槽位里），
 * 同一个函数被喂了不同的 n，产出的配额表整体错位一格。
 * 客户样例里文案侧因此以为有 4 个正片槽位（实际 3 个），
 * 各段配额从 [36,50,38] 变成 [28,28,39,29]。
 *
 * @param openFlashMs 开场+快闪窗口时长；<=0（classic 模式）时第 0 格取 MIN_SPEECH_SLOT_MS 兜底
 * @param bodySlotDurationsMs 草稿正片段时长（含过短的纯画面段，由 speechSlotDurations 过滤）
 * @param segCount 文案总段数（含开场白那一段）
 * @returns 长度 = segCount 的槽位时长；草稿没有可用正片槽位时返回空数组（调用方维持原行为）
 */
export function slotDurationsForSegments(
  openFlashMs: number,
  bodySlotDurationsMs: number[] | undefined,
  segCount: number,
): number[] {
  const n = Math.max(1, Math.floor(segCount) || 1)
  if (n < 2) return []
  const body = speechSlotDurations(bodySlotDurationsMs, n - 1)
  if (body.length === 0) return []
  const open = Number.isFinite(openFlashMs) && openFlashMs > 0 ? openFlashMs : MIN_SPEECH_SLOT_MS
  return [open, ...body]
}

/**
 * 我们自己配音的**实测**语速（字/秒）。
 *
 * pipeline.ts 的 CHARS_PER_SEC = 6 是**换成豆包声音复刻 2.0 之前**测的
 *（注释里记的是「99 字念了 16.15 秒」）。换音色之后没人回测过。
 *
 * 2026-08-22 线上实测这条克隆音色（任务 fd61a260）：
 *   段0 27字/5064ms=5.33   段1 26字/4440ms=5.86
 *   段2 29字/5064ms=5.73   段3 37字/6816ms=5.43
 *   整体 119字/21384ms = 5.56 字/秒
 * 取 5.5 略保守：宁可字少一点靠补静音填满，也不要字多了靠变速压——
 * 变速有上限，压不动就会把时间轴顶开。
 *
 * 换音色就要重新标定。worker 日志里的「第 N 段配音 XXXXms」配上该段字数即可算出。
 */
export const SPEECH_CHARS_PER_SEC = 5.5

/** 按语速折算一段时长最多装得下多少字。语速缺省用 SPEECH_CHARS_PER_SEC（框架可覆盖） */
export function charsForSpeechMs(ms: number, charsPerSec = SPEECH_CHARS_PER_SEC): number {
  if (!Number.isFinite(ms) || ms <= 0) return 0
  return Math.round((ms / 1000) * charsPerSec)
}

/** 正片第 1 段念出书名之前的留白：快闪结束后先静一下，书名才落下来 */
export const BOOK_TITLE_LEAD_MS = 400

/**
 * 各段里**能用来说话**的时长——与「这一段在时间轴上占多长」不是一回事。
 *
 * 两处刻意留白，它们是节奏的一部分，不是可以拿来塞字的空间：
 *
 * 1. **第 0 段**在时间轴上占「开场 + 快闪」整个窗口，但话只能说到碎裂动画结束为止；
 *    快闪那一段（书封一张张翻过去）原片是没有旁白的。
 *    此前这里按整个窗口给字数，开场白因此被写成 27 字、念了 5064ms，
 *    整个快闪期间都在说话，还得靠变速压——留白被字填满了。
 * 2. **第 1 段**开头留 BOOK_TITLE_LEAD_MS，让书名在快闪之后停顿一下再出口。
 *
 * @param timelineMs slotDurationsForSegments 的产出（各段在时间轴上的长度）
 * @param openWindowMs 开场碎裂窗口（快闪之前那段），<=0 或不小于第 0 格时不裁
 */
export function speechCapacities(
  timelineMs: number[],
  openWindowMs: number,
  bookTitleLeadMs = BOOK_TITLE_LEAD_MS,
): number[] {
  if (!Array.isArray(timelineMs) || timelineMs.length === 0) return []
  return timelineMs.map((t, i) => {
    if (i === 0) return openWindowMs > 0 && openWindowMs < t ? openWindowMs : t
    if (i === 1 && bookTitleLeadMs > 0) return Math.max(MIN_SPEECH_SLOT_MS, t - bookTitleLeadMs)
    return t
  })
}

/**
 * 按权重把总字数按比例分到各段（每段不低于 MIN_CHARS_PER_SEG）。
 * 权重就是各槽位时长——**槽位多长就分多少字**。
 */
export function charBudgetsFromWeights(weights: number[], totalChars: number): number[] {
  const n = Math.max(1, weights.length)
  const total = Math.max(n * MIN_CHARS_PER_SEG, Math.floor(totalChars) || 0)
  const sum = weights.reduce((a, b) => a + b, 0)
  if (!Number.isFinite(sum) || sum <= 0) {
    const each = Math.floor(total / n)
    return new Array(n).fill(each)
  }
  // 先按比例分，再把因取整丢掉的字数补给最长的那一段
  const out = weights.map((w) => Math.max(MIN_CHARS_PER_SEG, Math.round((w / sum) * total)))
  const drift = total - out.reduce((a, b) => a + b, 0)
  if (drift !== 0) {
    let longest = 0
    for (let i = 1; i < out.length; i++) if (weights[i] > weights[longest]) longest = i
    out[longest] = Math.max(MIN_CHARS_PER_SEG, out[longest] + drift)
  }
  return out
}
