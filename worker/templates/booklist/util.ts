/** HTML 文本转义，防止字幕/标题里的特殊字符破坏结构 */
export function esc(s: string): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** ms → 秒（保留 3 位小数，去掉浮点尾巴） */
export function sec(ms: number): number {
  return Math.round((ms / 1000) * 1000) / 1000
}
