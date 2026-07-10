import { prisma, transitionTask, enqueue, scoreMaterial } from '@mixcut/db'

export async function matchMaterials(taskId: string): Promise<void> {
  const taskSegments = await prisma.taskSegment.findMany({
    where: { taskId },
    include: { segment: { include: { tags: true } } },
    orderBy: { orderNo: 'asc' },
  })
  const materials = await prisma.material.findMany({ include: { tags: true } })

  const unmatched: number[] = []
  for (const ts of taskSegments) {
    if (ts.materialId) continue // 保留人工关联结果
    const segTagIds = ts.segment?.tags.map((t) => t.tagId) ?? []
    let best: { id: string; score: number } | null = null
    for (const m of materials) {
      const score = scoreMaterial(segTagIds, m.tags.map((t) => t.tagId))
      if (score >= 1 && (!best || score > best.score)) best = { id: m.id, score }
    }
    if (best) {
      await prisma.taskSegment.update({ where: { id: ts.id }, data: { materialId: best.id } })
    } else {
      unmatched.push(ts.orderNo)
    }
  }

  if (unmatched.length > 0) {
    await transitionTask(taskId, 'MATERIAL_PENDING', `素材不足，待补充分镜段：${unmatched.join('、')}`)
    return
  }
  await transitionTask(taskId, 'STORYBOARD_READY', '分镜与素材匹配完成')
  await transitionTask(taskId, 'RENDERING', '开始渲染初稿')
  await enqueue('render-draft', taskId)
}
