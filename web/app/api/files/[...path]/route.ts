import { NextRequest } from 'next/server'
import path from 'path'
import fs from 'fs'
import { getSession } from '@/lib/auth'
import { DATA_DIR } from '@/lib/paths'
import { verifyAssetToken } from '@mixcut/db'

const MIME: Record<string, string> = {
  '.mp4': 'video/mp4', '.jpg': 'image/jpeg', '.srt': 'text/plain; charset=utf-8',
  '.json': 'application/json', '.png': 'image/png',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.m4a': 'audio/mp4', '.aac': 'audio/aac', '.ogg': 'audio/ogg',
}

export async function GET(req: NextRequest, { params }: { params: { path: string[] } }) {
  const rel = params.path.join('/')
  // 若带 sig（供外部服务/DashScope 拉取），用签名校验替代登录态；无 sig 走原有内部鉴权
  const sig = req.nextUrl.searchParams.get('sig')
  if (sig) {
    if (!verifyAssetToken(rel, sig, Date.now())) {
      return new Response('invalid or expired signature', { status: 403 })
    }
  } else if (!(await getSession())) {
    return new Response('未登录', { status: 401 })
  }
  const abs = path.normalize(path.join(DATA_DIR, rel))
  const root = path.resolve(DATA_DIR)
  if (abs !== root && !abs.startsWith(root + path.sep)) return new Response('非法路径', { status: 400 })
  if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) return new Response('不存在', { status: 404 })

  const size = fs.statSync(abs).size
  const type = MIME[path.extname(abs).toLowerCase()] ?? 'application/octet-stream'
  const range = req.headers.get('range')
  if (range) {
    const m = /^bytes=(\d*)-(\d*)$/.exec(range)
    let start = 0
    let end = size - 1
    let satisfiable = !!m && (m[1] !== '' || m[2] !== '')
    if (satisfiable) {
      if (m![1] === '') {
        // suffix range: bytes=-<suffix>
        const suffix = parseInt(m![2])
        start = Math.max(0, size - suffix)
        end = size - 1
      } else {
        start = parseInt(m![1])
        end = m![2] !== '' ? Math.min(parseInt(m![2]), size - 1) : size - 1
      }
      if (start > end || start >= size) satisfiable = false
    }
    if (!satisfiable) {
      return new Response(null, {
        status: 416,
        headers: { 'Content-Range': `bytes */${size}` },
      })
    }
    const stream = fs.createReadStream(abs, { start, end })
    return new Response(stream as unknown as ReadableStream, {
      status: 206,
      headers: {
        'Content-Range': `bytes ${start}-${end}/${size}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': String(end - start + 1),
        'Content-Type': type,
      },
    })
  }
  return new Response(fs.createReadStream(abs) as unknown as ReadableStream, {
    headers: { 'Content-Length': String(size), 'Content-Type': type, 'Accept-Ranges': 'bytes' },
  })
}
