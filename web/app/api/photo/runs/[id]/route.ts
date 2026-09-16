// 学员端：单次生图详情（轮询用）。越权按「不存在」处理（404 而非 403），与 tools runs 口径一致。
// errorMsg 学员端收口：原始报错可能带服务器路径/上游响应体，学员看到一句人话即可；
// operator 不收口（排障要看原文）。
import { NextResponse } from 'next/server'
import { prisma } from '@mixcut/db'
import { requireRole, HttpError } from '@/lib/auth'
import { handler } from '@/lib/api'

export const GET = handler(async (_req, { params }) => {
  const s = await requireRole()
  const run = await prisma.photoGenRun.findUnique({
    where: { id: params.id },
    select: {
      id: true, userId: true, mode: true, shotMode: true, style: true, count: true,
      status: true, outputImages: true, errorMsg: true, inputImage: true,
      creditsCost: true, refunded: true, createdAt: true, finishedAt: true,
    },
  })
  if (!run || (run.userId !== s.userId && s.role !== 'operator')) throw new HttpError(404, '记录不存在')

  const errorMsg = run.errorMsg
    ? (s.role === 'operator' ? run.errorMsg : '生成失败，积分已退回。可换一张更清晰的照片重试')
    : null
  const { userId: _u, ...rest } = run
  return NextResponse.json({ ...rest, errorMsg })
})
