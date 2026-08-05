import { NextResponse } from 'next/server'
import { parseJianyingDraft, extractDraftMedia } from '@mixcut/db'
import { requireRole, HttpError } from '@/lib/auth'
import { handler } from '@/lib/api'
import { checkRate } from '@/lib/ratelimit'

// 解析剪映草稿 draft_content.json → 模板参数预览：运营鉴权 + 限流，纯解析不落库。
// v1 仅接受 draft_content.json（对象或文本）；zip 解压留作后续，避免引入 zip 依赖。
export const POST = handler(async (req) => {
  const s = await requireRole('operator')
  checkRate('jianying-parse', s.userId, 20)
  const body = await req.json().catch(() => {
    throw new HttpError(400, '请求体格式错误')
  })
  const { draftJson } = body ?? {}
  if (draftJson === undefined || draftJson === null) {
    throw new HttpError(400, '请上传草稿里的 draft_content.json')
  }
  let draft: unknown = draftJson
  if (typeof draftJson === 'string') {
    try {
      draft = JSON.parse(draftJson)
    } catch {
      throw new HttpError(400, '不是合法的 draft_content.json')
    }
  }
  const { params, meta } = parseJianyingDraft(draft)
  return NextResponse.json({ templateParams: params, meta, media: extractDraftMedia(draft) })
})
