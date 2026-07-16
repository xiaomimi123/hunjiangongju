import { NextResponse } from 'next/server'
import path from 'path'
import fs from 'fs/promises'
import { prisma } from '@mixcut/db'
import { requireRole, HttpError } from '@/lib/auth'
import { handler } from '@/lib/api'
import { DATA_DIR } from '@/lib/paths'

// 删除一首 BGM：先查引用（FK 为 ON DELETE SET NULL，delete 不会抛错，必须显式预检），
// 无引用时才删库记录 + 尽力删文件；有引用返回 409 友好提示。
export const DELETE = handler(async (_req, { params }) => {
  await requireRole('operator')
  const bgm = await prisma.bgmLibrary.findUnique({ where: { id: params.id } })
  if (!bgm) throw new HttpError(404, 'BGM 不存在')
  const used = await prisma.renderTask.count({ where: { bgmId: params.id } })
  if (used > 0) throw new HttpError(409, `该 BGM 被 ${used} 个渲染任务引用，无法删除`)
  await prisma.bgmLibrary.delete({ where: { id: bgm.id } })
  const rel = bgm.fileUrl.replace(/^\/api\/files\//, '')
  await fs.unlink(path.join(DATA_DIR, rel)).catch(() => {})
  return NextResponse.json({ ok: true })
})
