import { NextRequest } from 'next/server'
import path from 'path'
import fs from 'fs'
import { getSession } from '@/lib/auth'
import { DATA_DIR } from '@/lib/paths'

const MIME: Record<string, string> = {
  '.mp4': 'video/mp4', '.jpg': 'image/jpeg', '.srt': 'text/plain; charset=utf-8',
  '.json': 'application/json', '.png': 'image/png',
}

export async function GET(req: NextRequest, { params }: { params: { path: string[] } }) {
  if (!(await getSession())) return new Response('未登录', { status: 401 })
  const rel = params.path.join('/')
  const abs = path.normalize(path.join(DATA_DIR, rel))
  if (!abs.startsWith(path.normalize(DATA_DIR))) return new Response('非法路径', { status: 400 })
  if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) return new Response('不存在', { status: 404 })

  const size = fs.statSync(abs).size
  const type = MIME[path.extname(abs).toLowerCase()] ?? 'application/octet-stream'
  const range = req.headers.get('range')
  if (range) {
    const m = /bytes=(\d*)-(\d*)/.exec(range)
    const start = m?.[1] ? parseInt(m[1]) : 0
    const end = m?.[2] ? Math.min(parseInt(m[2]), size - 1) : size - 1
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
