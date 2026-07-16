import { prisma } from './client'

export async function transitionRender(renderTaskId: string, to: string, note?: string): Promise<void> {
  const t = await prisma.renderTask.findUniqueOrThrow({ where: { id: renderTaskId } })
  await prisma.$transaction([
    prisma.renderTask.update({ where: { id: renderTaskId }, data: { status: to } }),
    prisma.renderStatusLog.create({ data: { renderTaskId, fromStatus: t.status, toStatus: to, note } }),
  ])
}

export async function setGenerationStatus(genTaskId: string, to: string): Promise<void> {
  await prisma.generationTask.update({ where: { id: genTaskId }, data: { status: to } })
}

export async function setSourceStatus(sourceVideoId: string, to: string): Promise<void> {
  await prisma.sourceVideo.update({ where: { id: sourceVideoId }, data: { status: to } })
}

export async function writeQc(renderTaskId: string, checkType: string, result: string, detail?: string): Promise<void> {
  await prisma.renderQcReport.create({ data: { renderTaskId, checkType, result, detail } })
}
