import ffmpeg from 'fluent-ffmpeg'
import path from 'path'
import fs from 'fs/promises'

function thumbPathFor(srcAbs: string): string {
  const ext = path.extname(srcAbs)
  const base = ext ? srcAbs.slice(0, -ext.length) : srcAbs
  return `${base}.thumb.webp`
}

/** 生成 <原图同目录>/<basename>.thumb.webp（宽 360 等比）。失败仅记 warning,不抛错 */
export async function makeThumb(srcAbs: string): Promise<boolean> {
  const dst = thumbPathFor(srcAbs)
  try {
    await new Promise<void>((resolve, reject) => {
      ffmpeg(srcAbs)
        .outputOptions(['-y', '-vf', 'scale=360:-2', '-quality', '78'])
        .output(dst)
        .on('end', () => resolve())
        .on('error', reject)
        .run()
    })
    return true
  } catch (err) {
    console.warn(`[thumb] makeThumb 失败 ${srcAbs}: ${(err as Error).message}`)
    // ffmpeg 在解码失败前可能已经建立了目标文件（0 字节）：不清理的话，这个 URL 会
    // 200+0 字节返回而不是 404，调用方的"回退原图"逻辑永远不会被触发。
    await fs.unlink(dst).catch(() => {})
    return false
  }
}

/** 由原图 URL 推导缩略图 URL：/api/files/gen/x/3.png → /api/files/gen/x/3.thumb.webp */
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
