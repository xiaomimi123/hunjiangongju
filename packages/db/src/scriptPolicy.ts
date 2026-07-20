export function countChars(lines: string[]): number {
  return Array.from(lines.join('')).length // code points，CJK 正确
}

export function validateScript(lines: string[], maxLines = 21, maxTotalChars = 220) {
  const clean = lines.map((l) => l.trim()).filter(Boolean)
  const chars = countChars(clean)
  const errors: string[] = []
  if (clean.length > maxLines) errors.push(`正文最多 ${maxLines} 行，当前 ${clean.length}`)
  if (chars > maxTotalChars) errors.push(`正文最多 ${maxTotalChars} 字，当前 ${chars}`)
  return { lines: clean.length, chars, errors, clean }
}

/**
 * 兜底裁剪：LLM 多次重试仍略超预算时，按整行丢弃末尾行使其落在 maxLines/maxTotalChars 内，
 * 避免生成硬失败（真实 books 模式书评常小幅超限）。整行裁剪不切句，字幕仍完整。
 */
export function trimToBudget(lines: string[], maxLines = 21, maxTotalChars = 220): string[] {
  const clean = lines.map((l) => l.trim()).filter(Boolean)
  const out: string[] = []
  for (const line of clean) {
    if (out.length >= maxLines) break
    if (countChars([...out, line]) > maxTotalChars) break
    out.push(line)
  }
  // 极端：首行本身即超预算 → 截断首行到 maxTotalChars 码点，至少留一行
  if (out.length === 0 && clean.length > 0) {
    out.push(Array.from(clean[0]).slice(0, Math.max(1, maxTotalChars)).join(''))
  }
  return out
}

/**
 * 根据段数（及可选的源转写字数）推导拆解框架的字数/行数上限，
 * 保证「段数多」时不会把 maxTotalChars 卡在一个远小于段数所需的固定值上
 * （修复 F3：11 段 / 120 字导致生成必失败的死结）。
 */
export function deriveCharBudget(segmentCount: number, transcriptLen: number) {
  const seg = Math.max(1, segmentCount)
  const perSeg = 18
  const floor = seg * 8
  const bySeg = Math.round(seg * perSeg)
  const byText = Math.min(transcriptLen || 0, 600)
  const maxTotalChars = Math.min(600, Math.max(floor, bySeg, byText))
  const maxLines = Math.max(seg, Math.ceil(maxTotalChars / 12))
  return { maxLines, maxTotalChars }
}
