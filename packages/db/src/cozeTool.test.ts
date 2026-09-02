import { describe, it, expect, afterAll } from 'vitest'
import { prisma } from './client'

// CozeTool / CozeToolRun 是「扣子工作流工具箱」的地基两张表——这里只钉死
// 最基本的读写往返，以及 CozeToolRun 的默认值（QUEUED / refunded=false）。
// refunded 是退积分的幂等闸：默认必须是 false，否则「只退一次」在应用层无从判断。

const toolIds: string[] = []
const runIds: string[] = []

afterAll(async () => {
  await prisma.cozeToolRun.deleteMany({ where: { id: { in: runIds } } })
  await prisma.cozeTool.deleteMany({ where: { id: { in: toolIds } } })
  await prisma.$disconnect()
})

describe('CozeTool', () => {
  it('create + findUnique 回读字段一致', async () => {
    const created = await prisma.cozeTool.create({
      data: {
        name: '测试工具',
        description: '一个测试用的扣子工作流工具',
        workflowId: 'wf-123',
        inputs: [{ name: 'topic', label: '主题', type: 'text', required: true }],
        priceCredits: 3,
        enabled: true,
        sortOrder: 5,
      },
    })
    toolIds.push(created.id)

    const found = await prisma.cozeTool.findUnique({ where: { id: created.id } })
    expect(found).not.toBeNull()
    expect(found?.name).toBe('测试工具')
    expect(found?.description).toBe('一个测试用的扣子工作流工具')
    expect(found?.workflowId).toBe('wf-123')
    expect(found?.inputs).toEqual([{ name: 'topic', label: '主题', type: 'text', required: true }])
    expect(found?.priceCredits).toBe(3)
    expect(found?.enabled).toBe(true)
    expect(found?.sortOrder).toBe(5)
  })

  it('默认值：description 空串 / priceCredits=1 / enabled=false / sortOrder=0', async () => {
    const created = await prisma.cozeTool.create({
      data: { name: '默认值工具', workflowId: 'wf-456', inputs: [] },
    })
    toolIds.push(created.id)

    expect(created.description).toBe('')
    expect(created.priceCredits).toBe(1)
    expect(created.enabled).toBe(false)
    expect(created.sortOrder).toBe(0)
  })
})

describe('CozeToolRun', () => {
  it('create + findUnique 回读字段一致，且默认 status=QUEUED / refunded=false', async () => {
    const tool = await prisma.cozeTool.create({
      data: { name: '被运行的工具', workflowId: 'wf-789', inputs: [] },
    })
    toolIds.push(tool.id)

    const created = await prisma.cozeToolRun.create({
      data: {
        toolId: tool.id,
        userId: 'user-fake-id',
        inputs: { topic: '示例主题' },
        creditsCost: 2,
      },
    })
    runIds.push(created.id)

    // 默认值：新建的运行记录必须是排队中、且没有被退过款
    expect(created.status).toBe('QUEUED')
    expect(created.refunded).toBe(false)

    const found = await prisma.cozeToolRun.findUnique({ where: { id: created.id } })
    expect(found).not.toBeNull()
    expect(found?.toolId).toBe(tool.id)
    expect(found?.userId).toBe('user-fake-id')
    expect(found?.inputs).toEqual({ topic: '示例主题' })
    expect(found?.creditsCost).toBe(2)
    expect(found?.status).toBe('QUEUED')
    expect(found?.refunded).toBe(false)
    expect(found?.outputRaw).toBeNull()
    expect(found?.outputItems).toBeNull()
    expect(found?.errorMsg).toBeNull()
    expect(found?.finishedAt).toBeNull()
  })
})
