import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import { NextRequest } from 'next/server'
import os from 'os'
import path from 'path'
import fs from 'fs/promises'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { prisma } from '@mixcut/db'

const execFileAsync = promisify(execFile)

// 路由内部通过 DATA_DIR 常量落盘，需在导入路由前设好，指向临时目录（测试结束整体清理）。
const tmpDataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'seg-route-test-'))
process.env.DATA_DIR = tmpDataDir

const requireRoleMock = vi.fn()
vi.mock('@/lib/auth', async () => {
  const actual = await vi.importActual<typeof import('@/lib/auth')>('@/lib/auth')
  return { ...actual, requireRole: (...args: unknown[]) => requireRoleMock(...args) }
})

const { PATCH } = await import('./route')

const frameworkIds: string[] = []
const taskIds: string[] = []

beforeAll(() => {
  requireRoleMock.mockResolvedValue({ userId: 'op1', role: 'operator' })
})

afterAll(async () => {
  await prisma.generationTask.deleteMany({ where: { id: { in: taskIds } } })
  await prisma.copyFramework.deleteMany({ where: { id: { in: frameworkIds } } })
  await prisma.$disconnect()
  await fs.rm(tmpDataDir, { recursive: true, force: true })
})

async function makeTask() {
  const fw = await prisma.copyFramework.create({ data: { frameworkText: '测试框架文本' } })
  frameworkIds.push(fw.id)
  const task = await prisma.generationTask.create({
    data: { subject: '测试选题', frameworkId: fw.id, status: 'ASSET_READY', createdBy: 'op1' },
  })
  taskIds.push(task.id)
  const seg = await prisma.generatedSegment.create({
    data: { generationTaskId: task.id, seqNo: 1, scriptText: '原文案', imageUrl: `/api/files/gen/${task.id}/1.png` },
  })
  return { task, seg }
}

// 现场用 ffmpeg CLI 生成一张真实小图（不经 fluent-ffmpeg，避免其能力探测误判），
// 用于换图上传，验证 PATCH 触发的 makeThumb 真的能跑通解码。
async function realPngBytes(color: string): Promise<Buffer> {
  const tmp = path.join(await fs.mkdtemp(path.join(os.tmpdir(), 'seg-src-')), 'x.png')
  await execFileAsync('ffmpeg', ['-y', '-f', 'lavfi', '-i', `color=c=${color}:s=64x64`, '-frames:v', '1', '-update', '1', tmp])
  return fs.readFile(tmp)
}

function patchReq(taskId: string, fd: FormData) {
  return new NextRequest(`http://localhost/api/generate/${taskId}/segments/1`, { method: 'PATCH', body: fd })
}

describe('PATCH /api/generate/[id]/segments/[segNo] — 换图后缩略图', () => {
  it('换图成功后，同名 .thumb.webp 被重新生成（覆盖旧的桩内容，而非保留旧字节返回 200 stale）', async () => {
    const { task } = await makeTask()
    const abs = path.join(tmpDataDir, 'gen', task.id, '1.png')
    const thumbAbs = path.join(tmpDataDir, 'gen', task.id, '1.thumb.webp')
    await fs.mkdir(path.dirname(abs), { recursive: true })
    await fs.writeFile(abs, Buffer.from('old png bytes (占位,非真实图片)'))
    // 模拟"换图前已存在的旧缩略图"——如果 PATCH 没有重新生成，这段桩内容会原样留在原地。
    const staleThumb = Buffer.from('STALE-THUMB-PLACEHOLDER')
    await fs.writeFile(thumbAbs, staleThumb)

    const fd = new FormData()
    fd.append('image', new File([await realPngBytes('red')], 'new.png', { type: 'image/png' }))
    const res = await PATCH(patchReq(task.id, fd), { params: { id: task.id, segNo: '1' } })
    expect(res.status).toBe(200)

    const thumbBytes = await fs.readFile(thumbAbs)
    expect(thumbBytes.equals(staleThumb)).toBe(false) // 旧缩略图桩内容必须已被替换
    expect(thumbBytes.length).toBeGreaterThan(0)
  })

  it('换图上传的图片无法被 ffmpeg 解码（makeThumb 失败）时，换图请求本身仍返回 200（缩略图失败不拖垮换图）', async () => {
    const { task } = await makeTask()
    const abs = path.join(tmpDataDir, 'gen', task.id, '1.png')
    await fs.mkdir(path.dirname(abs), { recursive: true })
    await fs.writeFile(abs, Buffer.from('placeholder'))

    // 扩展名/MIME 都合法(.png / image/png)，但内容是随机字节，ffmpeg 解码会失败。
    const garbage = Buffer.from(Array.from({ length: 500 }, () => Math.floor(Math.random() * 256)))
    const fd = new FormData()
    fd.append('image', new File([garbage], 'bad.png', { type: 'image/png' }))
    const res = await PATCH(patchReq(task.id, fd), { params: { id: task.id, segNo: '1' } })
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.imageUrl).toBe(`/api/files/gen/${task.id}/1.png`)

    // 原图必须已按新字节落盘（换图主流程不受缩略图失败影响）。
    const written = await fs.readFile(abs)
    expect(written.equals(garbage)).toBe(true)
  })
})
