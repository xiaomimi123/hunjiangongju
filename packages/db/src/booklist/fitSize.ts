/**
 * 按可用宽度把字号缩下来，避免长标题溢出画面。
 *
 * 中日韩字符按「一字一个字号宽」估，ASCII 按半个——这是等宽近似，不精确，
 * 但字幕层只需要"不溢出"，宁可略小。剪映自己也是这么处理的：
 * 同一层的 clip.scale 随书名长度从 1.407 缩到 0.698。
 */
export function fitSizePx(text: string, basePx: number, widthPx: number, marginPx = 40): number {
  // ★ 按**最长的那一行**量，不是整串。
  // 第一版把整串当一行：常驻大标题的文本是「《书名》\N作者」，连 ASS 的换行转义一起算进去，
  // 于是 9 字的书名被当成 18 字，缩到 35px —— 比 54px 的正文字幕还小（线上实测）。
  // 真换行与 ASS 的 \N 都要切：调用点传的是**未转义**的原文（含真换行），
  // 只认 \N 的话换行符会被当成一个字算进宽度。
  // 注：搬到 packages/db 后被 web/tsconfig.json（无 target，隐含 ES3、未开
  // downlevelIteration）纳入类型检查程序，原来的 `[...line]` 会报 TS2802。
  // 换成 Array.from(line) 对字符串是等价写法（同样按 code point 迭代），
  // 不改变任何行为——本包其它文件（如 fitSegments.ts）也是这么写的。
  const cells = text
    .split(/\r?\n|\\N/)
    .reduce((m, line) => Math.max(m, Array.from(line).reduce((n, ch) => n + (ch.charCodeAt(0) < 0x2e80 ? 0.5 : 1), 0)), 0)
  if (cells <= 0) return basePx
  const max = Math.floor((widthPx - marginPx * 2) / cells)
  return Math.max(18, Math.min(basePx, max))
}
