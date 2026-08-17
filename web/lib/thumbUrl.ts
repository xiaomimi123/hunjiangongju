import path from 'path'

/**
 * 由原图 URL 推导缩略图 URL：/api/files/gen/x/3.png → /api/files/gen/x/3.thumb.webp
 *
 * 纯字符串函数，不依赖 fs/ffmpeg —— 独立成文件是为了客户端组件（网格/预览页）能安全
 * import，而不会把 web/lib/thumb.ts 里的 fluent-ffmpeg/fs（Node-only）一并打进浏览器包。
 */
export function thumbUrl(originalUrl: string): string {
  // 先剥离查询串/hash 再推导扩展名，否则 "3.png?t=169999.123" 会被 path.extname
  // 误判成 ".123"；推导完成后把原查询串原样拼回，不破坏调用方的 cache-busting。
  const qIdx = originalUrl.search(/[?#]/)
  const base = qIdx === -1 ? originalUrl : originalUrl.slice(0, qIdx)
  const suffix = qIdx === -1 ? '' : originalUrl.slice(qIdx)
  const ext = path.extname(base)
  if (!ext) return originalUrl
  return base.slice(0, -ext.length) + '.thumb.webp' + suffix
}
