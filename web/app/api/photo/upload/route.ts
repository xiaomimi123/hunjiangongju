// 学员端：实拍生图的原图上传（拍照/相册）。落盘 DATA_DIR/photo-uploads/，
// 返回的相对路径要能过 web/lib/photoInputs.ts 的 INPUT_REL_RE。
import { NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import path from 'path'
import fs from 'fs/promises'
import { requireRole, HttpError } from '@/lib/auth'
import { handler } from '@/lib/api'
import { checkRate } from '@/lib/ratelimit'
import { DATA_DIR } from '@/lib/paths'

// .jpeg 统一存成 .jpg：files 服务的 MIME 表只认 .jpg，存 .jpeg 会退化成 octet-stream 触发下载
const EXT_MAP: Record<string, string> = { '.jpg': 'jpg', '.jpeg': 'jpg', '.png': 'png', '.webp': 'webp' }
const MAX_SIZE = 15 * 1024 * 1024 // 手机原相机照片普遍 5-12MB，给到 15MB

export const POST = handler(async (req) => {
  const s = await requireRole()
  checkRate('photo-upload', s.userId, 20)
  const form = await req.formData()
  const file = form.get('file')
  if (!(file instanceof File)) throw new HttpError(400, '缺少文件')

  const ext = EXT_MAP[path.extname(file.name).toLowerCase()]
  if (!ext) throw new HttpError(400, '只支持 jpg/jpeg/png/webp 图片（iPhone 请在相机设置里选「兼容性最佳」或从相册选择）')
  if (file.size > MAX_SIZE) throw new HttpError(400, '图片不能超过 15MB')

  const rel = `photo-uploads/${randomUUID()}.${ext}`
  const abs = path.join(DATA_DIR, rel)
  await fs.mkdir(path.dirname(abs), { recursive: true })
  await fs.writeFile(abs, Buffer.from(await file.arrayBuffer()))

  return NextResponse.json({ rel })
})
