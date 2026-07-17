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
