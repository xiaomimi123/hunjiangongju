// 扣子工具的演示/教学视频上传：存 DATA_DIR/coze-tool-media/，返回 /api/files/ 路径。
// 不绑定具体工具——上传归上传，把返回的 URL 填进工具的 demoVideoUrl/tutorialVideoUrl
// 再保存才生效（与输入项「探测后需保存」同一心智）。
import { NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import path from 'path'
import fs from 'fs/promises'
import { requireRole, HttpError } from '@/lib/auth'
import { handler } from '@/lib/api'
import { checkRate } from '@/lib/ratelimit'
import { DATA_DIR } from '@/lib/paths'

const VIDEO_EXT = new Set(['.mp4', '.mov', '.webm'])
const MAX_BYTES = 200 * 1024 * 1024

export const POST = handler(async (req) => {
  const { userId } = await requireRole('operator')
  checkRate('coze-tool-video', userId, 20)

  const form = await req.formData()
  const file = form.get('file')
  if (!(file instanceof File)) throw new HttpError(400, '缺少视频文件')
  const ext = path.extname(file.name).toLowerCase()
  if (!VIDEO_EXT.has(ext)) throw new HttpError(400, `不支持的视频格式：${file.name}（支持 mp4/mov/webm）`)
  if (file.size > MAX_BYTES) {
    throw new HttpError(400, `视频过大（${Math.round(file.size / 1048576)}MB），请压到 200MB 以内`)
  }

  const rel = `coze-tool-media/${randomUUID()}${ext}`
  const abs = path.join(DATA_DIR, rel)
  await fs.mkdir(path.dirname(abs), { recursive: true })
  await fs.writeFile(abs, Buffer.from(await file.arrayBuffer()))
  return NextResponse.json({ url: `/api/files/${rel}` })
})
