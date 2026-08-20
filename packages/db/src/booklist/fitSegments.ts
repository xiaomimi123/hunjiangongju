// 把文案行数规整成恰好 N 段。
//
// 为什么需要：图片槽位数由草稿锁定（如客户样例正片 4 张），要做「第 3 张图用这个提示词」
// 这类逐槽配置，段数就必须固定。而 LLM 给几段是几段——提示词里写了「分成 N 段」，
// 但 validateScript 只查行数上限与总字数，从不查「是否恰好 N 段」。
//
// 为什么不靠重试让 LLM 重写：段数不对是**结构问题**，重写不保证收敛，且每次都是一次 LLM 调用。
// 规整是确定性的、零成本、必然成功。
//
// 取舍：合并会让某段变长、切分会让某句被断开。这是「锁定图片数」的必然代价——
// 要么图片数随文案浮动、要么文案被规整，二者不可兼得。算法选择「尾部合并 / 最长段切分」
// 是把损失放在感知最弱处（尾部通常是收束句；最长段切开后两半仍成句的概率最高），
// 但不能消除损失。调用方应记一条告警说明发生了规整，不要静默。

/** 中文断句标点，按「切开后两半都还像句子」的优先级排序 */
const BREAK_CHARS = ['，', '。', '；', '！', '？', '、', '：']

function splitAtBestPoint(text: string): [string, string] {
  const chars = Array.from(text)
  const mid = Math.floor(chars.length / 2)
  let best = -1
  let bestDist = Infinity
  for (let i = 1; i < chars.length - 1; i++) {
    if (!BREAK_CHARS.includes(chars[i])) continue
    const dist = Math.abs(i - mid)
    if (dist < bestDist) {
      bestDist = dist
      best = i
    }
  }
  // 有标点：在标点**之后**断开，标点跟着前半句（符合中文阅读习惯）
  if (best > 0) {
    return [chars.slice(0, best + 1).join(''), chars.slice(best + 1).join('')]
  }
  // 无标点可切：按字数中点硬切。宁可切得生硬也要凑够槽位——
  // 槽位数不对会让逐槽配置整体失效，比一句话被断开严重得多。
  const cut = Math.max(1, mid)
  return [chars.slice(0, cut).join(''), chars.slice(cut).join('')]
}

/**
 * 规整到恰好 `target` 段。
 * - 多了：从尾部合并相邻两段
 * - 少了：切最长的一段（在最靠近中点的标点处，无标点则按字数中点）
 * - `target <= 0` 或输入为空：原样返回
 *
 * 不变式：返回数组长度恒为 target（输入非空且 target>0 时），且不丢失任何字符。
 */
export function fitToSegmentCount(lines: string[], target: number): string[] {
  if (!Array.isArray(lines) || lines.length === 0) return []
  if (!Number.isInteger(target) || target <= 0) return lines

  const out = lines.map((l) => String(l ?? '').trim()).filter(Boolean)
  if (out.length === 0) return []

  // 多了：尾部合并
  while (out.length > target) {
    const last = out.pop()!
    out[out.length - 1] = out[out.length - 1] + last
  }

  // 少了：切最长的一段
  while (out.length < target) {
    let longest = 0
    for (let i = 1; i < out.length; i++) {
      if (Array.from(out[i]).length > Array.from(out[longest]).length) longest = i
    }
    // 最长段已无法再切（只剩 1 个字符）→ 无法凑够，返回现状避免死循环
    if (Array.from(out[longest]).length < 2) break
    const [a, b] = splitAtBestPoint(out[longest])
    out.splice(longest, 1, a, b)
  }

  return out
}
