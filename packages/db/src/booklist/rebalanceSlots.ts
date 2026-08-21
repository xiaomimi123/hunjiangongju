// 把已经分好段的文案，按各槽位的目标字数**重新分配**。
//
// 为什么需要：fitToSegmentCount 只保证「恰好 N 段」，不保证「每段多长」。
// 逐段字数配额（deriveSlotCharBudgets）是在**生成提示词**里给 LLM 的建议，
// 而建议不是约束——线上实测一条 117 字的文案里，最后一段被塞了约一半的字，
// 配音 13464ms 对着草稿 6067ms 的槽位（+122%），成片从 24.6 秒涨到 31.3 秒。
// 前两段反而都精确落在草稿槽位上（5704/8065ms），说明补静音机制本身没问题——
// 问题就是**字没按槽位分**。
//
// 所以这里做一次确定性的兜底：字数分布严重偏离配额时，把整段文案按标点拆成句子，
// 再按各槽位的目标字数重新装回去。不新增 LLM 调用，不丢字。
//
// 两条刻意的克制：
// 1. **偏离不大就不动**。重排会打乱 LLM 原本的段落语义（每段对应一张配图），
//    只在明显失衡时才介入。
// 2. **开场白不参与重排**（调用方只把正片段传进来）。开场白与第二段的分工是硬约定：
//    开场白不得出现书名、书名留到第二段开头。把句子跨过这条边界搬运会直接破坏它。

import { BREAK_CHARS } from './fitSegments'

/** 超过目标字数这个倍数才认为「失衡」，值以下原样保留 LLM 的分段 */
const DEFAULT_TOLERANCE = 1.4

const len = (s: string): number => Array.from(s).length

/**
 * 按中文标点切句，标点跟着前半句（符合中文阅读习惯）。
 * 换行也算断点，但不产生空句。
 */
export function splitSentences(text: string): string[] {
  const sents: string[] = []
  let cur = ''
  for (const ch of Array.from(String(text ?? ''))) {
    if (ch === '\n' || ch === '\r') {
      if (cur.trim()) sents.push(cur)
      cur = ''
      continue
    }
    cur += ch
    if (BREAK_CHARS.includes(ch)) {
      sents.push(cur)
      cur = ''
    }
  }
  if (cur.trim()) sents.push(cur)
  return sents.filter((s) => s.trim())
}

/**
 * 按 `targetChars` 的**比例**重新分配各段字数。
 *
 * @param lines 已经是恰好 N 段的文案（**不含开场白**）
 * @param targetChars 各段目标字数，长度须与 lines 相同
 * @param tolerance 失衡判定阈值，默认 1.4（某段超出目标 40% 才介入）
 * @returns 重排后的 N 段；判定不失衡、或输入不合法、或切不出足够句子时**原样返回**
 *
 * 不丢字：返回各段拼接起来与输入各段拼接起来完全相同。
 */
export function rebalanceToSlotChars(
  lines: string[],
  targetChars: number[],
  tolerance = DEFAULT_TOLERANCE,
): string[] {
  if (!Array.isArray(lines) || !Array.isArray(targetChars)) return lines
  if (lines.length < 2 || lines.length !== targetChars.length) return lines
  if (targetChars.some((t) => !Number.isFinite(t) || t <= 0)) return lines

  const balanced = lines.every((l, i) => len(l) <= targetChars[i] * tolerance)
  if (balanced) return lines

  const sents = splitSentences(lines.join(''))
  // 句子数还不够铺满槽位 → 重排只会把某段掏空，不如不动
  if (sents.length < lines.length) return lines

  // ★ 目标要按**实际总字数**等比缩放，不能直接用配额的绝对值。
  //
  // 重排的职责是让各段字数的**比例**贴合槽位时长的比例；总量该是多少由
  // 字数预算（deriveDraftCharBudget）和硬上限管，不归这里。
  // 直接用绝对配额的话，前几段各自填到配额就停，超出配额的部分会**全部**
  // 落进最后一段——那正是这次要修的症状，只是换个地方复发。
  const actual = lines.reduce((a, l) => a + len(l), 0)
  const planned = targetChars.reduce((a, t) => a + t, 0)
  const scale = planned > 0 ? actual / planned : 1

  const goals = targetChars.map((t) => t * scale)
  const n = lines.length
  const m = sents.length
  // 前缀和：cut(a,b) = 第 a..b-1 句的总字数
  const pre = [0]
  for (const s of sents) pre.push(pre[pre.length - 1] + len(s))
  const spanLen = (a: number, b: number): number => pre[b] - pre[a]

  // ★ 用动态规划求**精确最优**的连续切分，不用贪心/边界启发式。
  //
  // 试过两种启发式，都不够好：贪心（吃句子到再吃一句就离目标更远）在句子长时
  // 会整段冲过头；按累积边界分（句子中点落在哪个区间就归哪段）误差虽不累积，
  // 但一句话险险落在边界一侧就会把整段撑歪——实测某段因此偏了 24%。
  //
  // 「把 m 个句子切成 n 段连续块、最小化各段与目标的偏差」是可以精确求解的：
  // m 与 n 都很小（句子几十、段数个位数），DP 的开销可以忽略。
  // 代价用**平方**误差：偏差大的段惩罚更重，避免用几段小偏差换一段大偏差。
  const INF = Infinity
  const cost: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(INF))
  const from: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(-1))
  cost[0][0] = 0
  for (let i = 1; i <= n; i++) {
    // 第 i 段结束在第 j 句；前 i 段至少各占一句，后面还要留 n-i 句
    for (let j = i; j <= m - (n - i); j++) {
      for (let k = i - 1; k < j; k++) {
        if (cost[i - 1][k] === INF) continue
        const d = spanLen(k, j) - goals[i - 1]
        const c = cost[i - 1][k] + d * d
        if (c < cost[i][j]) {
          cost[i][j] = c
          from[i][j] = k
        }
      }
    }
  }
  if (cost[n][m] === INF) return lines

  const cuts = new Array(n + 1).fill(0)
  cuts[n] = m
  for (let i = n; i >= 1; i--) cuts[i - 1] = from[i][cuts[i]]
  const out = Array.from({ length: n }, (_, i) => sents.slice(cuts[i], cuts[i + 1]).join(''))
  // 兜底：真出现空段时不冒险，退回原分段
  if (out.some((t) => !t.trim())) return lines
  return out
}
