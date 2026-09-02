// 拉参数代理：新建/编辑工具时，运营输入 workflowId 后点「自动拉取参数」，
// 后端代为调用扣子（避免把 Token 暴露到浏览器）。
// cozeFetchWorkflowParams 返回 null 是预期路径（该扣子版本没有这个查询接口，
// 或工作流未发布），不是错误——照 brief 返回 hint 让运营手动添加输入项。
// 配置问题（未配 Token/鉴权失败等）会抛错——转成 HttpError(502, 原始中文信息) 而不是让它
// 落到 handler 通用的 500「服务器内部错误」：运营要在后台 UI 上直接看到具体原因（比如
// 「扣子未配置，请在模型配置里填 Token」）才能自己排查，不然只能来问开发。
import { NextResponse } from 'next/server'
import { cozeFetchWorkflowParams } from '@mixcut/db'
import { requireRole, HttpError } from '@/lib/auth'
import { handler } from '@/lib/api'
import { validateWorkflowId } from '@/lib/cozeToolAdmin'

export const POST = handler(async (req) => {
  await requireRole('operator')
  const body = await req.json().catch(() => {
    throw new HttpError(400, '请求体格式错误')
  })
  const workflowId = validateWorkflowId(body.workflowId)

  let params: Awaited<ReturnType<typeof cozeFetchWorkflowParams>>
  try {
    params = await cozeFetchWorkflowParams(workflowId)
  } catch (e) {
    if (e instanceof HttpError) throw e
    throw new HttpError(502, (e as Error).message)
  }
  if (params === null) {
    return NextResponse.json({ params: null, hint: '扣子未提供参数查询，请手动添加输入项' })
  }
  return NextResponse.json({ params })
})
