import ffmpeg from 'fluent-ffmpeg'
import path from 'path'

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
    return false
  }
}

/** 由原图 URL 推导缩略图 URL：/api/files/gen/x/3.png → /api/files/gen/x/3.thumb.webp */
export function thumbUrl(originalUrl: string): string {
  const ext = path.extname(originalUrl)
  if (!ext) return originalUrl
  return originalUrl.slice(0, -ext.length) + '.thumb.webp'
}
