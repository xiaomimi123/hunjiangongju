import { describe, it, expect, afterAll } from 'vitest'
import { prisma } from './client'
import { transitionRender, writeQc } from './renderState'

const ids: { fw?: string; gen?: string; rt?: string } = {}

describe('renderState', () => {
  it('transitionRender 改状态并写日志', async () => {
    const fw = await prisma.copyFramework.create({ data: { frameworkText: 't' } }); ids.fw = fw.id
    const gen = await prisma.generationTask.create({ data: { frameworkId: fw.id, subject: 's' } }); ids.gen = gen.id
    const rt = await prisma.renderTask.create({ data: { generationTaskId: gen.id, status: 'RENDERING' } }); ids.rt = rt.id
    await transitionRender(rt.id, 'PREVIEW_PENDING', '测试')
    const after = await prisma.renderTask.findUniqueOrThrow({ where: { id: rt.id } })
    expect(after.status).toBe('PREVIEW_PENDING')
    const logs = await prisma.renderStatusLog.findMany({ where: { renderTaskId: rt.id } })
    expect(logs).toHaveLength(1)
    expect(logs[0].fromStatus).toBe('RENDERING')
    await writeQc(rt.id, 'black_frame', 'pass', 'ok')
    expect(await prisma.renderQcReport.count({ where: { renderTaskId: rt.id } })).toBe(1)
  })
})

afterAll(async () => {
  if (ids.rt) await prisma.renderTask.delete({ where: { id: ids.rt } }).catch(() => {})
  if (ids.gen) await prisma.generationTask.delete({ where: { id: ids.gen } }).catch(() => {})
  if (ids.fw) await prisma.copyFramework.delete({ where: { id: ids.fw } }).catch(() => {})
  await prisma.$disconnect()
})
