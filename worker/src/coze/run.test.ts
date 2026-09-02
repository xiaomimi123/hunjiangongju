// processCozeRun 的行为测试：假 deps（不打真扣子、不发真网络）+ 真数据库。
// 覆盖 task-8-brief 列的全部场景：成功链路落库、失败退分、幂等退分（不能退两次）、
// image 字段走 uploadFile、转存后 url 是本站路径、超限不转存但注明、
// 不存在的 runId 不炸、RUNNING 写入在调扣子之前。

import { describe, it, expect, vi, afterAll, beforeEach } from 'vitest'
import { promises as fs } from 'fs'
import path from 'path'
import os from 'os'

// ★ DATA_DIR 必须赶在任何 import 之前钉死——paths.ts 在模块加载时读环境变量，
// 手法同 renderPipeline.test.ts / generateTts.e2e.test.ts。
const dataDir = vi.hoisted(() => {
  const dir = `${process.env.TMPDIR ?? '/tmp'}/mixcut-coze-run-${process.pid}-${Date.now()}`
  process.env.DATA_DIR = dir
  return dir
})

import { prisma } from '@mixcut/db'
import { processCozeRun, type CozeRunDeps } from './run'

const userIds: string[] = []
const toolIds: string[] = []
const runIds: string[] = []

afterAll(async () => {
  await prisma.cozeToolRun.deleteMany({ where: { id: { in: runIds } } })
  await prisma.cozeTool.deleteMany({ where: { id: { in: toolIds } } })
  await prisma.user.deleteMany({ where: { id: { in: userIds } } })
  await fs.rm(dataDir, { recursive: true, force: true })
  await prisma.$disconnect()
})

let seq = 0
async function makeUser(credits = 30) {
  seq += 1
  const u = await prisma.user.create({
    data: { email: `coze-run-${process.pid}-${seq}@test.local`, passwordHash: 'x', role: 'student', credits },
  })
  userIds.push(u.id)
  return u
}

async function makeTool(inputs: unknown[] = [], workflowId = 'wf-test') {
  const t = await prisma.cozeTool.create({ data: { name: '测试工具', workflowId, inputs: inputs as never } })
  toolIds.push(t.id)
  return t
}

async function makeRun(toolId: string, userId: string, opts: { inputs?: Record<string, unknown>; creditsCost?: number } = {}) {
  const r = await prisma.cozeToolRun.create({
    data: {
      toolId,
      userId,
      inputs: (opts.inputs ?? {}) as never,
      creditsCost: opts.creditsCost ?? 2,
    },
  })
  runIds.push(r.id)
  return r
}

function fakeDeps(overrides: Partial<CozeRunDeps> = {}): CozeRunDeps {
  return {
    uploadFile: vi.fn(async () => ({ fileId: 'fake-file-id' })),
    runWorkflow: vi.fn(async () => ({ raw: JSON.stringify({ text: '结果文案' }) })),
    download: vi.fn(async () => ({ buf: Buffer.from('fake-bytes'), contentType: 'image/png' })),
    ...overrides,
  }
}

beforeEach(async () => {
  await fs.mkdir(dataDir, { recursive: true })
})

describe('processCozeRun', () => {
  it('成功链路：状态/输出各字段落库正确', async () => {
    const user = await makeUser()
    const tool = await makeTool([{ name: 'topic', label: '主题', type: 'text', required: true }])
    const run = await makeRun(tool.id, user.id, { inputs: { topic: '一本好书' } })

    const deps = fakeDeps({
      runWorkflow: vi.fn(async () => ({
        raw: JSON.stringify({ text: '这是文案结果', image: 'https://coze.example.com/out/pic.png' }),
      })),
    })

    await processCozeRun(run.id, deps)

    const found = await prisma.cozeToolRun.findUniqueOrThrow({ where: { id: run.id } })
    expect(found.status).toBe('SUCCEEDED')
    expect(found.finishedAt).not.toBeNull()
    expect(found.errorMsg).toBeNull()
    expect(found.outputRaw).toEqual(JSON.stringify({ text: '这是文案结果', image: 'https://coze.example.com/out/pic.png' }))

    const items = found.outputItems as { kind: string; url?: string; text?: string }[]
    expect(items.some((i) => i.kind === 'text' && i.text === '这是文案结果')).toBe(true)
    const imageItem = items.find((i) => i.kind === 'image')
    expect(imageItem?.url).toMatch(new RegExp(`^/api/files/coze/${run.id}/[0-9a-f-]{36}\\.png$`))

    // 文件确实转存到磁盘
    const filename = imageItem!.url!.split('/').pop()!
    const abs = path.join(dataDir, 'coze', run.id, filename)
    await expect(fs.readFile(abs)).resolves.toEqual(Buffer.from('fake-bytes'))
  })

  it('image 类型输入字段：读本地文件、走 uploadFile、参数写入 fileId 引用', async () => {
    const user = await makeUser()
    const tool = await makeTool([{ name: 'ref_image', label: '参考图', type: 'image', required: true }])
    const relPath = 'coze-uploads/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.png'
    await fs.mkdir(path.join(dataDir, 'coze-uploads'), { recursive: true })
    await fs.writeFile(path.join(dataDir, relPath), Buffer.from('local-image-bytes'))
    const run = await makeRun(tool.id, user.id, { inputs: { ref_image: relPath } })

    const uploadFile = vi.fn(async (_buf: Buffer, _filename: string) => ({ fileId: 'coze-file-999' }))
    const runWorkflow = vi.fn(async (_workflowId: string, _parameters: Record<string, unknown>) => ({ raw: JSON.stringify({ text: 'ok' }) }))
    const deps = fakeDeps({ uploadFile, runWorkflow })

    await processCozeRun(run.id, deps)

    expect(uploadFile).toHaveBeenCalledTimes(1)
    const [buf, filename] = uploadFile.mock.calls[0]
    expect(buf).toEqual(Buffer.from('local-image-bytes'))
    expect(filename).toBe('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.png')

    expect(runWorkflow).toHaveBeenCalledTimes(1)
    const [, parameters] = runWorkflow.mock.calls[0]
    expect(parameters.ref_image).toBe(JSON.stringify({ file_id: 'coze-file-999' }))

    const found = await prisma.cozeToolRun.findUniqueOrThrow({ where: { id: run.id } })
    expect(found.status).toBe('SUCCEEDED')
  })

  it('runWorkflow 抛错 → FAILED + 积分退回', async () => {
    const user = await makeUser(30)
    // 模拟已扣分：真实入口在建 run 时同事务扣分，这里直接把余额调到扣分后的状态
    await prisma.user.update({ where: { id: user.id }, data: { credits: 27 } })
    const tool = await makeTool([])
    const run = await makeRun(tool.id, user.id, { creditsCost: 3 })

    const deps = fakeDeps({ runWorkflow: vi.fn(async () => { throw new Error('扣子挂了') }) })
    await processCozeRun(run.id, deps)

    const found = await prisma.cozeToolRun.findUniqueOrThrow({ where: { id: run.id } })
    expect(found.status).toBe('FAILED')
    expect(found.errorMsg).toBe('扣子挂了')
    expect(found.refunded).toBe(true)

    const refreshedUser = await prisma.user.findUniqueOrThrow({ where: { id: user.id } })
    expect(refreshedUser.credits).toBe(30)
  })

  it('重复调用同一失败 run：积分只退一次', async () => {
    const user = await makeUser(30)
    await prisma.user.update({ where: { id: user.id }, data: { credits: 25 } })
    const tool = await makeTool([])
    const run = await makeRun(tool.id, user.id, { creditsCost: 5 })

    const deps = fakeDeps({ runWorkflow: vi.fn(async () => { throw new Error('挂了') }) })
    await processCozeRun(run.id, deps)
    await processCozeRun(run.id, deps) // 重复处理同一个已 FAILED 的 run

    const refreshedUser = await prisma.user.findUniqueOrThrow({ where: { id: user.id } })
    expect(refreshedUser.credits).toBe(30) // 只退了一次 5 分，不是 35

    const found = await prisma.cozeToolRun.findUniqueOrThrow({ where: { id: run.id } })
    expect(found.refunded).toBe(true)
  })

  it('工具已被删除 → FAILED + 退分', async () => {
    const user = await makeUser(30)
    await prisma.user.update({ where: { id: user.id }, data: { credits: 28 } })
    const tool = await makeTool([])
    const run = await makeRun(tool.id, user.id, { creditsCost: 2 })
    await prisma.cozeTool.delete({ where: { id: tool.id } })
    toolIds.splice(toolIds.indexOf(tool.id), 1)

    await processCozeRun(run.id, fakeDeps())

    const found = await prisma.cozeToolRun.findUniqueOrThrow({ where: { id: run.id } })
    expect(found.status).toBe('FAILED')
    const refreshedUser = await prisma.user.findUniqueOrThrow({ where: { id: user.id } })
    expect(refreshedUser.credits).toBe(30)
  })

  it('转存后 url 改写为本站路径；超限的项不转存但保留原 url 并注明', async () => {
    const user = await makeUser()
    const tool = await makeTool([])
    const run = await makeRun(tool.id, user.id)

    const deps = fakeDeps({
      runWorkflow: vi.fn(async () => ({
        raw: JSON.stringify({
          small: 'https://coze.example.com/out/small.jpg',
          huge: 'https://coze.example.com/out/huge.mp4',
        }),
      })),
      download: vi.fn(async (url: string) => {
        if (url.includes('huge')) return { tooLarge: true as const }
        return { buf: Buffer.from('small-bytes'), contentType: 'image/jpeg' }
      }),
    })

    await processCozeRun(run.id, deps)

    const found = await prisma.cozeToolRun.findUniqueOrThrow({ where: { id: run.id } })
    const items = found.outputItems as { kind: string; url: string; note?: string }[]
    const small = items.find((i) => i.url.includes('small') || i.kind === 'image')
    const huge = items.find((i) => i.kind === 'video')
    expect(small?.url.startsWith(`/api/files/coze/${run.id}/`)).toBe(true)
    expect(huge?.url).toBe('https://coze.example.com/out/huge.mp4') // 保留原始远程地址，未转存
    expect(huge?.note).toBeTruthy()
  })

  it('不存在的 runId：不炸，warn 后直接返回', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await expect(processCozeRun('does-not-exist-xyz', fakeDeps())).resolves.toBeUndefined()
    expect(warnSpy).toHaveBeenCalled()
    warnSpy.mockRestore()
  })

  it('RUNNING 状态写入在调 runWorkflow 之前', async () => {
    const user = await makeUser()
    const tool = await makeTool([])
    const run = await makeRun(tool.id, user.id)

    let statusWhenCalled: string | undefined
    const deps = fakeDeps({
      runWorkflow: vi.fn(async () => {
        const mid = await prisma.cozeToolRun.findUniqueOrThrow({ where: { id: run.id } })
        statusWhenCalled = mid.status
        return { raw: JSON.stringify({ text: 'ok' }) }
      }),
    })

    await processCozeRun(run.id, deps)
    expect(statusWhenCalled).toBe('RUNNING')
  })
})
