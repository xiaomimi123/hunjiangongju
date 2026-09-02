// 参数自动探测代理：workflowId 已知但扣子该版本没有参数查询接口（fetch-params
// 拿不到）时，运营点「自动探测」——后端故意跑一次流式运行，靠扣子的参数校验
// 报错反推参数表。cozeProbeWorkflowParams 的收敛逻辑见 packages/db/src/ai/cozeProbe.ts。
//
// started=true 代表探测过程中工作流已经真实启动了一次（参数校验全过，扣子开始跑），
// 不是纯粹的只读探测——响应里附一句 warning，提醒运营去扣子后台确认这次运行没有
// 不可逆副作用（发消息/写数据之类）。
// error 字段（非 Missing/非 file 转换的报错，例如工作流未发布）跟 fields 一起原样透传，
// 让运营在前端直接看到具体原因，不用来问开发。
import { NextResponse } from 'next/server'
import { cozeProbeWorkflowParams } from '@mixcut/db'
import { requireRole, HttpError } from '@/lib/auth'
import { handler } from '@/lib/api'
import { validateWorkflowId } from '@/lib/cozeToolAdmin'

export const POST = handler(async (req) => {
  await requireRole('operator')
  const body = await req.json().catch(() => {
    throw new HttpError(400, '请求体格式错误')
  })
  const workflowId = validateWorkflowId(body.workflowId)

  let result: Awaited<ReturnType<typeof cozeProbeWorkflowParams>>
  try {
    result = await cozeProbeWorkflowParams(workflowId)
  } catch (e) {
    if (e instanceof HttpError) throw e
    throw new HttpError(502, (e as Error).message)
  }

  return NextResponse.json({
    fields: result.fields,
    ...(result.started ? { warning: '探测过程已真实启动一次该工作流，请到扣子后台确认无副作用' } : {}),
    ...(result.error ? { error: result.error } : {}),
  })
})
