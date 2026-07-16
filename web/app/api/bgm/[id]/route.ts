import { NextResponse } from 'next/server'
import path from 'path'
import fs from 'fs/promises'
import { prisma } from '@mixcut/db'
import { requireRole, HttpError } from '@/lib/auth'
import { handler } from '@/lib/api'
import { DATA_DIR } from '@/lib/paths'

// 删除一首 BGM：删库记录 + 尽力删文件（被 RenderTask 引用时 FK 会阻止，返回 409 友好提示）
export const DELETE = handler(async (_req, { params }) => {
  await requireRole('operator')
  const bgm = await prisma.bgmLibrary.findUnique({ where: { id: params.id } })
  if (!bgm) throw new HttpError(404, 'BGM 不存在')
  try {
    await prisma.bgmLibrary.delete({ where: { id: bgm.id } })
  } catch {
    throw new HttpError(409, '该 BGM 已被合成任务引用，暂不可删除')
  }
  const rel = bgm.fileUrl.replace(/^\/api\/files\//, '')
  await fs.unlink(path.join(DATA_DIR, rel)).catch(() => {})
  return NextResponse.json({ ok: true })
})
