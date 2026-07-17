import { NextResponse } from 'next/server'
import { prisma, publicAssetUrl } from '@mixcut/db'
import { requireRole, HttpError } from '@/lib/auth'
import { handler } from '@/lib/api'

export const GET = handler(async (_req, { params }) => {
  const session = await requireRole('operator')
  const source = await prisma.sourceVideo.findUnique({
    where: { id: params.id },
    select: {
      id: true,
      douyinShareUrl: true,
      videoFileUrl: true,
      status: true,
      createdAt: true,
      createdBy: true,
      transcripts: {
        orderBy: { createdAt: 'desc' },
        take: 1,
        select: { id: true, fullText: true, sentences: true, createdAt: true },
      },
      sceneCuts: {
        select: { id: true, cutPointsMs: true },
      },
      frameworks: {
        orderBy: { createdAt: 'desc' },
        select: { id: true, name: true, industryCategory: true, createdAt: true },
      },
    },
  })
  if (!source) throw new HttpError(404, '拆解任务不存在')
  if (source.createdBy && source.createdBy !== session.userId) throw new HttpError(404, '不存在')

  const { transcripts, createdBy: _createdBy, ...rest } = source
  // 转写已生成 ⇒ transcribe 步骤中抽取的 source/<id>.wav 必然已落盘，可直接拼出签名地址供
  // 拆解结果页「用此声音克隆」按钮使用；未生成转写前不给出，避免指向不存在的文件
  const sourceAudioAssetUrl = transcripts[0] ? publicAssetUrl(`source/${source.id}.wav`) : null
  return NextResponse.json({ ...rest, transcript: transcripts[0] ?? null, sourceAudioAssetUrl })
})
