import { NextResponse } from 'next/server'
import { prisma, enqueueGen } from '@mixcut/db'
import { requireRole, HttpError } from '@/lib/auth'
import { handler } from '@/lib/api'

export const POST = handler(async (req) => {
  const session = await requireRole('operator')
  const body = (await req.json().catch(() => {
    throw new HttpError(400, '请求体格式错误')
  })) as { shareUrl?: unknown }

  const shareUrl = body.shareUrl
  if (typeof shareUrl !== 'string' || !shareUrl.includes('http')) {
    throw new HttpError(400, '请粘贴有效的抖音分享链接')
  }

  const source = await prisma.sourceVideo.create({
    data: {
      douyinShareUrl: shareUrl,
      status: 'CREATED',
      createdBy: session.userId,
    },
  })

  await enqueueGen('download-douyin', { sourceVideoId: source.id })

  return NextResponse.json({ id: source.id })
})
