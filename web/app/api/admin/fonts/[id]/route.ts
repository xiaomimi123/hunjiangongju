import { NextResponse } from 'next/server'
import path from 'path'
import fs from 'fs/promises'
import { prisma } from '@mixcut/db'
import { requireRole } from '@/lib/auth'
import { handler } from '@/lib/api'
import { DATA_DIR } from '@/lib/paths'

/**
 * 删除自定义字体，同时删磁盘文件。
 *
 * 幂等：删不存在的 id 也返回 200（与 BGM 删除同口径，见 commit fc4f4aa）——
 * 删除的语义是「让它不存在」，已经不存在就是成功，不该对连点第二发报错。
 */
export const DELETE = handler(async (_req, { params }) => {
  await requireRole('operator')
  const row = await prisma.customFont.findUnique({ where: { id: params.id } })
  if (row) {
    await fs.rm(path.join(DATA_DIR, 'fonts', row.fileName), { force: true })
    await prisma.customFont.delete({ where: { id: row.id } })
  }
  return NextResponse.json({ ok: true })
})
