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

/**
 * 内置字体目录探测 —— 这里探两个候选路径不是过度设计，是两个运行时环境的 cwd 真的不一样：
 *
 * - 生产：web/Dockerfile 的 CMD 是 `npm run start -w web`。npm 的 `-w`（workspace）
 *   参数会把子进程 cwd 设成该 workspace 目录本身，即 `/app/web`，所以要从
 *   `/app/web` 往上一级找到 `/app/worker/templates/booklist/fonts`。
 * - 测试：`vitest.config.ts` 放在仓库根，vitest 跑测试时 cwd 就是仓库根，
 *   这时 `worker/templates/booklist/fonts` 已经在 cwd 平级，不用再往上找。
 *
 * 两种 cwd 差一级，任何一侧的相对路径写法在另一侧都会解析到不存在的目录。
 * 没有用 __dirname 兜底：Next 构建后会把路由文件搬进 `.next/server/app/...`，
 * __dirname 不再对着源码树，同样靠不住。
 *
 * ★ 别把这里简化成单一路径。简化后在两个环境里必有一个探测不到目录，
 * 后果是**静默 404**——`findBuiltinFont` 命中了、字体条目本身没错，只是这
 * 一步读文件失败，画布预览会悄悄回退系统字体，而不是报错；界面上看不出
 * 任何异常，只有肉眼比对预览与成片字体不一致才会发现，排查成本极高。
 */
function resolveBuiltinDir(): string {
  const candidates = [
    path.resolve(process.cwd(), 'worker/templates/booklist/fonts'),
    path.resolve(process.cwd(), '../worker/templates/booklist/fonts'),
  ]
  return candidates.find((c) => existsSync(c)) ?? candidates[0]
}

const BUILTIN_DIR = resolveBuiltinDir()

/** 扩展名到 MIME 类型的映射。内置 5 款字体里霞鹜文楷、站酷快乐体是 .ttf，
 * 自定义字体上传时也只收 .ttf/.otf 两种 —— 不能写死 font/otf，会把 .ttf
 * 字体标错类型。 */
function contentTypeFor(fileAbs: string): string {
  const ext = path.extname(fileAbs).toLowerCase()
  if (ext === '.otf') return 'font/otf'
  if (ext === '.ttf') return 'font/ttf'
  return 'application/octet-stream'
}

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
      'content-type': contentTypeFor(abs),
      etag,
      // 内置字体文件本身不会原地变更；自定义字体每次上传都是新 id + 新随机文件名，
      // 不存在"同一 URL 内容会变"的情况，可以放心 immutable。
      'cache-control': 'public, max-age=31536000, immutable',
    },
  })
})
