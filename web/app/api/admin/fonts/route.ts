// 自定义字体上传 / 列表：后台可选字体功能。
// 族名与字重都不接受运营手填——一律用 readFontMeta 从文件里解析。
// 手填族名的后果是 ASS 的 Fontname 对不上，成片静默回退默认字体、毫无报错；
// 手填字重的后果是粗体字体选了不加粗，界面设了、成片没变化、日志也不报错。
import { NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import path from 'path'
import fs from 'fs/promises'
import { prisma, readFontMeta, BUILTIN_FONTS } from '@mixcut/db'
import { requireRole, HttpError } from '@/lib/auth'
import { handler } from '@/lib/api'
import { DATA_DIR } from '@/lib/paths'

const FONT_EXT = new Set(['.ttf', '.otf'])
const MAX_BYTES = 30 * 1024 * 1024

function fontsDir(): string {
  return path.join(DATA_DIR, 'fonts')
}

// 字体清单：内置 5 款 + 自定义（下拉框数据源）
export const GET = handler(async () => {
  await requireRole('operator')
  const custom = await prisma.customFont.findMany({
    orderBy: { createdAt: 'desc' },
    select: { id: true, label: true, family: true, weight: true, createdAt: true },
  })
  return NextResponse.json({ builtin: BUILTIN_FONTS, custom })
})

// 上传自定义字体：multipart file + label?
export const POST = handler(async (req) => {
  await requireRole('operator')
  const form = await req.formData()
  const file = form.get('file')
  if (!(file instanceof File)) throw new HttpError(400, '缺少字体文件')

  const ext = path.extname(file.name).toLowerCase()
  if (!FONT_EXT.has(ext)) throw new HttpError(400, '只支持 .ttf / .otf 字体文件')
  if (file.size > MAX_BYTES) throw new HttpError(400, '字体文件不能超过 30MB')

  const dir = fontsDir()
  await fs.mkdir(dir, { recursive: true })

  // 落盘用随机文件名：用户提供的文件名可能含 ../ 或特殊字符，是路径穿越风险，不能直接用。
  const fileName = `${randomUUID()}${ext}`
  const abs = path.join(dir, fileName)
  await fs.writeFile(abs, Buffer.from(await file.arrayBuffer()))

  let meta: { family: string; weight: 400 | 700 }
  try {
    meta = readFontMeta(abs)
  } catch (e) {
    // 解析失败必须删掉已落盘的临时文件，不能留孤儿文件。
    await fs.rm(abs, { force: true })
    throw new HttpError(400, `字体解析失败：${(e as Error).message}`)
  }

  const labelRaw = String(form.get('label') ?? '').trim()
  const label = (labelRaw || meta.family).slice(0, 40)

  const row = await prisma.customFont.create({
    data: { label, family: meta.family, weight: meta.weight, fileName },
    select: { id: true, label: true, family: true, weight: true },
  })
  return NextResponse.json(row)
})
