import { NextResponse } from 'next/server'
import { prisma, readFrameworkDefaults, readImageSlots } from '@mixcut/db'
import { requireRole } from '@/lib/auth'
import { handler } from '@/lib/api'

export const GET = handler(async () => {
  await requireRole('operator')
  const rows = await prisma.copyFramework.findMany({
    orderBy: { createdAt: 'desc' },
    select: { id: true, name: true, industryCategory: true, visualStyleType: true, published: true, degradedNote: true, createdAt: true, overlayTemplate: true, draftFidelityReport: true },
  })
  return NextResponse.json(rows.map(({ overlayTemplate, ...r }) => ({
    ...r,
    defaultAssetFolder: readFrameworkDefaults(overlayTemplate).assetFolder,
    // 图片槽位数：没有它说明该框架不是走「一键导入」建的（缺依赖素材文件夹的参数），
    // 用它生成会让人误以为槽位配置没生效。列表页据此打标，避免选错框架。
    imageSlotCount: readImageSlots(overlayTemplate)?.count ?? null,
  })))
})
