import { NextResponse } from 'next/server'
import path from 'path'
import fs from 'fs/promises'
import { prisma } from '@mixcut/db'
import { requireRole, HttpError } from '@/lib/auth'
import { handler } from '@/lib/api'
import { DATA_DIR } from '@/lib/paths'

// 轻量编辑单段：multipart，可选 scriptText（改文案）/ image（换图）。
// 仅在 ASSET_READY 时允许。此处只落数据/文件，不改任务状态：
//   - 改文案后需重跑 TTS+对齐，由前端在批量保存后调 POST .../realign 触发一次。
//   - 换图不影响时轴，无需重对齐（直接覆盖同名 png，imageUrl 不变）。
export const PATCH = handler(async (req, { params }) => {
  const session = await requireRole('operator')
  const task = await prisma.generationTask.findUnique({ where: { id: params.id } })
  if (!task || task.createdBy !== session.userId) throw new HttpError(404, '生成任务不存在')
  if (task.status !== 'ASSET_READY') throw new HttpError(400, '仅在素材就绪（ASSET_READY）时可编辑分段')

  const seqNo = Number(params.segNo)
  if (!Number.isInteger(seqNo)) throw new HttpError(400, '分段序号无效')
  const seg = await prisma.generatedSegment.findFirst({ where: { generationTaskId: task.id, seqNo } })
  if (!seg) throw new HttpError(404, '分段不存在')

  const form = await req.formData().catch(() => {
    throw new HttpError(400, '请求体格式错误')
  })

  const data: { scriptText?: string; imageUrl?: string } = {}

  const rawText = form.get('scriptText')
  if (rawText !== null) {
    const scriptText = String(rawText).trim()
    if (!scriptText) throw new HttpError(400, '文案不能为空')
    data.scriptText = scriptText
  }

  const image = form.get('image')
  if (image instanceof File && image.size > 0) {
    if (!(image.type.startsWith('image/') || /\.(png|jpe?g|webp)$/i.test(image.name))) {
      throw new HttpError(400, '换图只支持图片文件')
    }
    // 覆盖同名 png，保持 image_url 稳定（下游 renderVisuals 用固定路径拷贝）
    const rel = `gen/${task.id}/${seqNo}.png`
    const abs = path.join(DATA_DIR, rel)
    await fs.mkdir(path.dirname(abs), { recursive: true })
    await fs.writeFile(abs, Buffer.from(await image.arrayBuffer()))
    data.imageUrl = `/api/files/${rel}`
  }

  if (Object.keys(data).length === 0) throw new HttpError(400, '没有要更新的内容')

  const updated = await prisma.generatedSegment.update({
    where: { id: seg.id },
    data,
    select: { seqNo: true, scriptText: true, imageUrl: true },
  })
  return NextResponse.json(updated)
})
