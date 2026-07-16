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
