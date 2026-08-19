import { NextResponse } from 'next/server'
import type { Prisma } from '@prisma/client'
import { prisma, parseTemplateParams, isFidelityReport } from '@mixcut/db'
import { requireRole, HttpError } from '@/lib/auth'
import { handler } from '@/lib/api'

// 把解析预览得到的模板参数保存为一条正式框架记录：运营鉴权，复用与拆解流水线（extractFramework）
// 相同的 CopyFramework 建表方式，只是 overlayTemplate 里挂 __templateParams（渲染时 renderVisuals 消费）。
export const POST = handler(async (req) => {
  const s = await requireRole('operator')
  const body = await req.json().catch(() => {
    throw new HttpError(400, '请求体格式错误')
  })
  const { name, templateParams, fidelityReport } = body ?? {}
  if (typeof name !== 'string' || !name.trim()) throw new HttpError(400, '名称不能为空')
  const normalized = { ...parseTemplateParams(templateParams), mode: 'flash' as const }
  // fidelityReport 由前端把 /parse 接口在服务端算出的报告原样回传（本路由拿不到原始草稿，
  // 无法自己重算）——属于客户端可篡改的输入，落库前必须做形状校验；非法直接丢弃、
  // 不硬失败：报告纯信息性展示，不参与任何渲染/计费决策。
  const validReport = isFidelityReport(fidelityReport) ? fidelityReport : null

  const fw = await prisma.copyFramework.create({
    data: {
      name: name.trim(),
      frameworkText: '（从剪映草稿导入的快闪模板，仅含画面/节奏参数，无文案框架，使用前请补充/编辑文案框架）',
      overlayTemplate: { __templateParams: normalized } as unknown as Prisma.InputJsonValue,
      createdBy: s.userId,
      ...(validReport ? { draftFidelityReport: validReport as unknown as Prisma.InputJsonValue } : {}),
    },
  })
  return NextResponse.json({ id: fw.id })
})
