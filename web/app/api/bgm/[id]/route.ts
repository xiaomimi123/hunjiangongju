import { NextResponse } from 'next/server'
import path from 'path'
import fs from 'fs/promises'
import { prisma } from '@mixcut/db'
import { requireRole, HttpError } from '@/lib/auth'
import { handler } from '@/lib/api'
import { DATA_DIR } from '@/lib/paths'

// 改名 / 改文件夹 / 改风格标签（行内编辑）。至少传一项；folder/styleTag 传空字符串视为「清空」，name 不允许清空。
export const PATCH = handler(async (req, { params }) => {
  await requireRole('operator')
  const bgm = await prisma.bgmLibrary.findUnique({ where: { id: params.id } })
  if (!bgm) throw new HttpError(404, 'BGM 不存在')
  const body = await req.json().catch(() => {
    throw new HttpError(400, '请求体格式错误')
  })
  const data: { name?: string; folder?: string | null; styleTag?: string | null } = {}
  if ('name' in body) {
    const name = typeof body.name === 'string' ? body.name.trim() : ''
    if (!name) throw new HttpError(400, '名称不能为空')
    data.name = name
  }
  if ('folder' in body) {
    const folder = typeof body.folder === 'string' ? body.folder.trim() : ''
    data.folder = folder || null
  }
  if ('styleTag' in body) {
    const styleTag = typeof body.styleTag === 'string' ? body.styleTag.trim() : ''
    data.styleTag = styleTag || null
  }
  if (Object.keys(data).length === 0) throw new HttpError(400, '至少传一项要修改的字段')
  const updated = await prisma.bgmLibrary.update({ where: { id: bgm.id }, data })
  return NextResponse.json(updated)
})

// 删除一首 BGM：先查引用（FK 为 ON DELETE SET NULL，delete 不会抛错，必须显式预检），
// 无引用时才删库记录 + 尽力删文件；有引用返回 409 友好提示。
//
// ★ 幂等：目标不存在时返回 ok 而不是 404。线上实测同一个删除被触发了两次
// （双击/连点），第一发已删掉、第二发 404 —— 对用户呈现为「删除报错」，
// 但他要的结果（这首歌没了）明明已经达成。删除的语义是「让它不存在」，
// 已经不存在就是成功。
export const DELETE = handler(async (_req, { params }) => {
  await requireRole('operator')
  const bgm = await prisma.bgmLibrary.findUnique({ where: { id: params.id } })
  if (!bgm) return NextResponse.json({ ok: true, alreadyGone: true })
  const used = await prisma.renderTask.count({ where: { bgmId: params.id } })
  if (used > 0) throw new HttpError(409, `该 BGM 被 ${used} 个渲染任务引用，无法删除`)
  await prisma.bgmLibrary.delete({ where: { id: bgm.id } })
  const rel = bgm.fileUrl.replace(/^\/api\/files\//, '')
  await fs.unlink(path.join(DATA_DIR, rel)).catch(() => {})
  return NextResponse.json({ ok: true })
})
