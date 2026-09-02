// 学员端：为扣子工具的 image 类型入参上传图片。落盘到 DATA_DIR/coze-uploads/，
// 返回的相对路径要能被 web/lib/cozeInputs.ts 的 IMAGE_REL_RE 校验通过。
import { NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import path from 'path'
import fs from 'fs/promises'
import { requireRole, HttpError } from '@/lib/auth'
import { handler } from '@/lib/api'
import { DATA_DIR } from '@/lib/paths'

// 用白名单扩展名而非 file.type：file.type 是浏览器自报的 MIME，不可信；
// path.extname 取真实文件名后缀——"xxx.png.exe" 取到的是 .exe，会被拒绝。
const EXT_MAP: Record<string, string> = { '.jpg': 'jpg', '.jpeg': 'jpeg', '.png': 'png', '.webp': 'webp' }
const MAX_SIZE = 10 * 1024 * 1024

export const POST = handler(async (req) => {
  await requireRole()
  const form = await req.formData()
  const file = form.get('file')
  if (!(file instanceof File)) throw new HttpError(400, '缺少文件')

  const ext = EXT_MAP[path.extname(file.name).toLowerCase()]
  if (!ext) throw new HttpError(400, '只支持 jpg/jpeg/png/webp 图片')
  if (file.size > MAX_SIZE) throw new HttpError(400, '图片不能超过 10MB')

  const rel = `coze-uploads/${randomUUID()}.${ext}`
  const abs = path.join(DATA_DIR, rel)
  await fs.mkdir(path.dirname(abs), { recursive: true })
  await fs.writeFile(abs, Buffer.from(await file.arrayBuffer()))

  return NextResponse.json({ rel })
})
