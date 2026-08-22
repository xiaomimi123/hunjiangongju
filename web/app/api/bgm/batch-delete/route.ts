import { NextResponse } from 'next/server'
import path from 'path'
import fs from 'fs/promises'
import { prisma } from '@mixcut/db'
import { requireRole, HttpError } from '@/lib/auth'
import { handler } from '@/lib/api'
import { DATA_DIR } from '@/lib/paths'

// 批量删除（全选删除用）。逐条处理而不是一条 deleteMany：
// 被渲染任务引用的要**跳过并报告**，不能因为其中一条被引用就整批失败，
// 也不能连引用的一起删（成片回放会找不到曲子的归属记录）。
export const POST = handler(async (req) => {
  await requireRole('operator')
  const body = await req.json().catch(() => {
    throw new HttpError(400, '请求体格式错误')
  })
  const ids: string[] = Array.isArray(body?.ids)
    ? (body.ids as unknown[]).filter((x): x is string => typeof x === 'string' && !!x).slice(0, 500)
    : []
  if (ids.length === 0) throw new HttpError(400, '没有要删除的条目')

  let deleted = 0
  const skipped: { id: string; name: string | null; reason: string }[] = []
  for (const id of ids) {
    const bgm = await prisma.bgmLibrary.findUnique({ where: { id } })
    if (!bgm) { deleted++; continue } // 幂等：已经没了 = 目标达成
    const used = await prisma.renderTask.count({ where: { bgmId: id } })
    if (used > 0) {
      skipped.push({ id, name: bgm.name, reason: `被 ${used} 个渲染任务引用` })
      continue
    }
    await prisma.bgmLibrary.delete({ where: { id } })
    const rel = bgm.fileUrl.replace(/^\/api\/files\//, '')
    await fs.unlink(path.join(DATA_DIR, rel)).catch(() => {})
    deleted++
  }
  return NextResponse.json({ ok: true, deleted, skipped })
})
