import { NextResponse } from 'next/server'
import { prisma, enrollVoice, listVoices } from '@mixcut/db'
import { requireRole, HttpError } from '@/lib/auth'
import { handler } from '@/lib/api'

// 音色列表：供 /admin/voices 页面与生成页音色选择器共用
export const GET = handler(async () => {
  await requireRole('operator')
  const list = await listVoices()
  return NextResponse.json(list)
})

// 克隆一个新音色：{ sampleAssetUrl, name } → enrollVoice（内部已建 ClonedVoice 记录）→ 返回该记录
export const POST = handler(async (req) => {
  await requireRole('operator')
  const body = await req.json().catch(() => {
    throw new HttpError(400, '请求体格式错误')
  })
  const name = typeof body?.name === 'string' ? body.name.trim() : ''
  const sampleAssetUrl = typeof body?.sampleAssetUrl === 'string' ? body.sampleAssetUrl.trim() : ''
  if (!name) throw new HttpError(400, '请填写音色名称')
  if (!sampleAssetUrl) throw new HttpError(400, '请提供样本音频地址')

  const { voiceId } = await enrollVoice(sampleAssetUrl, name)
  const voice = await prisma.clonedVoice.findUnique({ where: { voiceId } })
  if (!voice) throw new HttpError(500, '声音复刻记录写入失败')
  return NextResponse.json(voice)
})
