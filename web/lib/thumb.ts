import ffmpeg from 'fluent-ffmpeg'
import path from 'path'
import fs from 'fs/promises'
import { thumbUrl } from './thumbUrl'

// 重导出：thumbUrl 的实现挪到了 ./thumbUrl.ts（纯函数、无 Node-only 依赖），这样客户端
// 组件可以只 import 那个文件而不拖入本文件的 fluent-ffmpeg/fs。此处保留导出以兼容任何
// 仍从 '@/lib/thumb' 引用 thumbUrl 的服务端代码。
export { thumbUrl }

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
