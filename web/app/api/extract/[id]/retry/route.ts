import { NextResponse } from 'next/server'
import { prisma, enqueueGen, setSourceStatus } from '@mixcut/db'
import { requireRole, HttpError } from '@/lib/auth'
import { handler } from '@/lib/api'

// 拆解失败后的重试。此前失败只能「返回列表重新上传」——文件要重传一遍，
// 而 ASR 偶发 429/超时（3 分钟墙钟）是最常见的失败原因，整链重来纯属浪费。
//
// 按**已有产物**决定从哪一步续跑，不重复烧已经成功的步骤：
//   有分镜切点 → 只重跑框架提炼（LLM）
//   有转写     → 从场景检测起（ffmpeg，本地）
//   有视频文件 → 从 ASR 转写起
//   全都没有   → 从抖音链接重新下载（手动上传却没文件 = 数据坏了，报错）
export const POST = handler(async (_req, { params }) => {
  const session = await requireRole('operator')
  const source = await prisma.sourceVideo.findUnique({
    where: { id: params.id },
    select: {
      id: true, status: true, videoFileUrl: true, douyinShareUrl: true, createdBy: true,
      _count: { select: { transcripts: true, sceneCuts: true } },
    },
  })
  if (!source || (source.createdBy && source.createdBy !== session.userId)) {
    throw new HttpError(404, '拆解任务不存在')
  }
  if (source.status !== 'FAILED') throw new HttpError(400, '仅失败的拆解任务可重试')

  if (source._count.sceneCuts > 0) {
    await setSourceStatus(source.id, 'FRAMEWORK_EXTRACTING')
    await enqueueGen('extract-framework', { sourceVideoId: source.id })
    return NextResponse.json({ ok: true, resumedFrom: 'extract-framework' })
  }
  if (source._count.transcripts > 0) {
    await setSourceStatus(source.id, 'SCENE_DETECTING')
    await enqueueGen('detect-scenes', { sourceVideoId: source.id })
    return NextResponse.json({ ok: true, resumedFrom: 'detect-scenes' })
  }
  if (source.videoFileUrl) {
    await setSourceStatus(source.id, 'TRANSCRIBING')
    await enqueueGen('transcribe', { sourceVideoId: source.id })
    return NextResponse.json({ ok: true, resumedFrom: 'transcribe' })
  }
  if (source.douyinShareUrl && source.douyinShareUrl !== '(manual-upload)') {
    await setSourceStatus(source.id, 'DOWNLOADING')
    await enqueueGen('download-douyin', { sourceVideoId: source.id })
    return NextResponse.json({ ok: true, resumedFrom: 'download-douyin' })
  }
  throw new HttpError(400, '没有可续跑的素材（手动上传却缺文件），请删除后重新上传')
})
