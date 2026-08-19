import { NextResponse } from 'next/server'
import { parseJianyingDraft, extractDraftMedia, buildFidelityReport } from '@mixcut/db'
import { requireRole, HttpError } from '@/lib/auth'
import { handler } from '@/lib/api'
import { checkRate } from '@/lib/ratelimit'
import { looksLikePlainJsonHead } from '@/lib/draftText'

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
      // 看起来像 JSON（剥掉 BOM/空白后以 { 开头）但解析失败——按老提示报格式错误；
      // 不像 JSON（很可能是新版剪映约 6.5+/iOS 19.x 起默认加密的密文）——给可操作的提示。
      if (!looksLikePlainJsonHead(draftJson)) {
        throw new HttpError(400, '这份内容不是合法的 draft_content.json，看起来是加密的剪映草稿（新版剪映约 6.5+ / iOS 19.x 起默认加密），请改为上传整个剪映工程文件夹')
      }
      throw new HttpError(400, '不是合法的 draft_content.json')
    }
  }
  const { params, meta } = parseJianyingDraft(draft)
  // 保真度报告在这里（服务端，拿得到原始草稿）算出，随预览响应一起下发；前端仅原样持有、
  // 保存框架时原样回传给 save 路由（save 路由拿不到原始草稿，无法自己重算，见该文件注释）。
  const fidelityReport = buildFidelityReport(meta.provenance, new Date().toISOString())
  return NextResponse.json({ templateParams: params, meta, media: extractDraftMedia(draft), fidelityReport })
})
