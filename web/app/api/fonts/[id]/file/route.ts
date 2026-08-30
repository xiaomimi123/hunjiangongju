// 字体文件下发：给后台剪辑参数页的画布预览用。
//
// 预览拿到的**必须就是** worker 渲染时 fontsdir 里的那个二进制 —— 这是画布保真的
// 前提之一，所以内置字体也直接读 worker/templates/booklist/fonts/，不另存一份到
// web/public/fonts/（web/Dockerfile 是 COPY . .，整个仓库都在 web 镜像里，读得到）。
//
// 安全：params.id 来自 URL，不可信。内置走 findBuiltinFont 白名单查表，
// 自定义走数据库查询取 fileName —— 两条路径都不把 id 直接拼进文件路径，
// 避免路径穿越读到仓库外的文件。
import { NextResponse } from 'next/server'
import fs from 'fs/promises'
import { existsSync } from 'fs'
import path from 'path'
import { createHash } from 'crypto'
import { prisma, findBuiltinFont } from '@mixcut/db'
import { requireRole } from '@/lib/auth'
import { handler } from '@/lib/api'
import { DATA_DIR } from '@/lib/paths'

// process.cwd() 在生产（npm run start -w web，cwd=/app/web）与测试（vitest.config.ts
// 在仓库根，cwd=仓库根）下不是同一层级，两个候选都试一下，取先存在的那个，
// 避免用 __dirname（Next 构建后会把路由挪进 .next/server/，__dirname 不再对着源码树）。
function resolveBuiltinDir(): string {
  const candidates = [
    path.resolve(process.cwd(), 'worker/templates/booklist/fonts'),
    path.resolve(process.cwd(), '../worker/templates/booklist/fonts'),
  ]
  return candidates.find((c) => existsSync(c)) ?? candidates[0]
}

const BUILTIN_DIR = resolveBuiltinDir()

export const GET = handler(async (req, { params }) => {
  await requireRole('operator')

  let abs: string
  const b = findBuiltinFont(params.id)
  if (b) {
    abs = path.join(BUILTIN_DIR, b.file)
  } else {
    const row = await prisma.customFont.findUnique({ where: { id: params.id } })
    if (!row) return new NextResponse(null, { status: 404 })
    abs = path.join(DATA_DIR, 'fonts', row.fileName)
  }

  const buf = await fs.readFile(abs).catch(() => null)
  if (!buf) return new NextResponse(null, { status: 404 })

  const etag = `"${createHash('sha1').update(buf).digest('hex')}"`
  if (req.headers.get('if-none-match') === etag) {
    return new NextResponse(null, { status: 304, headers: { etag } })
  }

  return new NextResponse(buf, {
    headers: {
      'content-type': 'font/otf',
      etag,
      // 内置字体文件本身不会原地变更；自定义字体每次上传都是新 id + 新随机文件名，
      // 不存在"同一 URL 内容会变"的情况，可以放心 immutable。
      'cache-control': 'public, max-age=31536000, immutable',
    },
  })
})
