import { describe, it, expect, vi, afterAll, beforeAll } from 'vitest'
import { NextRequest } from 'next/server'
import os from 'os'
import path from 'path'
import fs from 'fs/promises'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { prisma } from '@mixcut/db'
import { HttpError } from '@/lib/auth'

const execFileAsync = promisify(execFile)

// 路由内部通过 DATA_DIR 常量落盘，需在导入路由前设好，指向临时目录（测试结束整体清理）。
const tmpDataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'jianying-import-route-test-'))
process.env.DATA_DIR = tmpDataDir

const requireRoleMock = vi.fn()
vi.mock('@/lib/auth', async () => {
  const actual = await vi.importActual<typeof import('@/lib/auth')>('@/lib/auth')
  return { ...actual, requireRole: (...args: unknown[]) => requireRoleMock(...args) }
})

const { POST } = await import('./route')

// 与其它 route.test.ts 并发跑在同一张共享测试库表上：绝不能用 deleteMany({}) 整表清空。
// 这里固定用了两个专属工程名，先在 beforeAll 做一次按 folder 精确清理，保证重跑幂等，
// 再全程只追踪本文件创建出来的 id 做 afterAll 清理。
const PROJECT = '导入测试工程'
const PROJECT2 = '导入测试工程2'
const createdBgm: string[] = []
const createdAssets: string[] = []
const createdFw: string[] = []

beforeAll(async () => {
  requireRoleMock.mockResolvedValue({ userId: 'op1', role: 'operator' })
  await prisma.bgmLibrary.deleteMany({ where: { folder: { in: [PROJECT, PROJECT2] } } })
  await prisma.stockAsset.deleteMany({ where: { folder: { in: [PROJECT, PROJECT2] } } })
})

afterAll(async () => {
  await prisma.bgmLibrary.deleteMany({ where: { id: { in: createdBgm } } })
  await prisma.stockAsset.deleteMany({ where: { id: { in: createdAssets } } })
  await prisma.copyFramework.deleteMany({ where: { id: { in: createdFw } } })
  await prisma.$disconnect()
  await fs.rm(tmpDataDir, { recursive: true, force: true })
})

function makeForm(over: Partial<Record<string, string>> = {}) {
  const form = new FormData()
  form.set('name', over.name ?? '导入测试框架')
  form.set('projectName', over.projectName ?? PROJECT)
  form.set('templateParams', over.templateParams ?? JSON.stringify({ mode: 'flash' }))
  form.set('bgmMeta', over.bgmMeta ?? JSON.stringify([{ fileName: 'song.mp3', title: '歌曲A' }]))
  form.append('bgmFiles', new File([new Uint8Array([1, 2, 3])], 'song.mp3', { type: 'audio/mpeg' }))
  form.append('imageFiles', new File([new Uint8Array([9, 9])], 'pic.png', { type: 'image/png' }))
  if (over.draftJson !== undefined) form.set('draftJson', over.draftJson)
  return form
}

// 与 packages/db/src/booklist/parseJianyingDraft.test.ts 同款最小可解析草稿：
// 用于验证 import 路由在收到原始草稿时会在服务端权威地重算保真度报告并落库。
const SAMPLE_DRAFT = {
  canvas_config: { width: 720, height: 960 },
  duration: 24601783,
  materials: {
    texts: [
      { id: 't_title', content: JSON.stringify({ text: '今天分享的是', styles: [{ font: { path: 'text/x/字由玄真.ttf' }, fill: { content: { solid: { color: [0, 0, 0] } } } }] }) },
      { id: 't_b1', content: JSON.stringify({ text: '《活着》', styles: [{ font: { path: 'text/x/字由玄真.ttf' }, fill: { content: { solid: { color: [0, 0, 0] } } } }] }) },
    ],
    material_animations: [{ id: 'a1', animations: [{ name: '破镜重圆' }] }],
    transitions: [{ id: 'tr1', name: '叠化', duration: 500000 }],
    audios: [{ id: 'au_bgm', name: '歌曲20260702' }],
  },
  tracks: [
    { type: 'video', segments: [{ target_timerange: { duration: 2158988 } }] },
    { type: 'audio', segments: [{ material_id: 'au_bgm', volume: 0.692, target_timerange: { start: 0, duration: 20000000 } }] },
    { type: 'sticker', segments: [
      { material_id: 't_title', target_timerange: { start: 0, duration: 2158988 }, clip: { transform: { y: -0.62 } }, extra_material_refs: ['a1'] },
      { material_id: 't_b1', target_timerange: { start: 2158988, duration: 150300 }, clip: { transform: { y: 0.66 } }, extra_material_refs: [] },
    ] },
  ],
}

// 现场用 ffmpeg CLI 生成一张真实小图（同 worker/src/thumb.test.ts / segments route.test.ts
// 的既有做法），用于验证 makeThumb 真的能对导入的图片跑通解码产出缩略图。
async function realPngBytes(color: string): Promise<Buffer> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'jianying-import-src-'))
  try {
    const tmp = path.join(dir, 'x.png')
    await execFileAsync('ffmpeg', ['-y', '-f', 'lavfi', '-i', `color=c=${color}:s=64x64`, '-frames:v', '1', '-update', '1', tmp])
    return await fs.readFile(tmp)
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
}

// makeForm() 默认带一份 bgmFiles/bgmMeta，只要没有 400 在写入前拦下、也没有命中同
// folder+name 的既有 BGM 复用，POST 就会新建一条 bgm_library 行——必须在这里补记
// id，afterAll 才清得掉，否则会像本文件之前那样往共享测试库里永久堆积孤儿行。
async function trackBgm(folder: string, name = '歌曲A') {
  createdBgm.push((await prisma.bgmLibrary.findFirstOrThrow({ where: { folder, name } })).id)
}

// 同理：makeForm() 默认也带一张 imageFiles(pic.png)，同样会新建一条 stock_asset 行。
async function trackAsset(folder: string, name = 'pic') {
  createdAssets.push((await prisma.stockAsset.findFirstOrThrow({ where: { folder, name } })).id)
}

function req(form: FormData) {
  return new NextRequest('http://localhost/api/admin/jianying/import', { method: 'POST', body: form })
}

async function call(form: FormData) {
  return POST(req(form), { params: {} })
}

describe('POST /api/admin/jianying/import', () => {
  it('非 operator → 401/403', async () => {
    requireRoleMock.mockRejectedValueOnce(new HttpError(403, '无权限'))
    const res = await call(makeForm())
    expect([401, 403]).toContain(res.status)
  })

  it('入库 BGM+素材,建框架并写默认值', async () => {
    const res = await call(makeForm())
    expect(res.status).toBe(200)
    const j = await res.json()
    createdFw.push(j.id)
    expect(j.bgm).toEqual({ imported: 1, reused: 0 })
    expect(j.assets).toEqual({ imported: 1, reused: 0 })
    const fw = await prisma.copyFramework.findUniqueOrThrow({ where: { id: j.id } })
    const ot = fw.overlayTemplate as Record<string, unknown>
    const bgm = await prisma.bgmLibrary.findFirstOrThrow({ where: { folder: PROJECT, name: '歌曲A' } })
    createdBgm.push(bgm.id)
    expect(ot.__defaultBgmId).toBe(bgm.id)
    expect(ot.__defaultAssetFolder).toBe(PROJECT)
    const asset = await prisma.stockAsset.findFirstOrThrow({ where: { folder: PROJECT, name: 'pic' } })
    createdAssets.push(asset.id)
    expect(asset.kind).toBe('image')
  })

  it('重复导入:媒体复用不重建,框架新建', async () => {
    const res = await call(makeForm())
    const j = await res.json()
    createdFw.push(j.id)
    expect(j.bgm).toEqual({ imported: 0, reused: 1 })
    expect(j.assets).toEqual({ imported: 0, reused: 1 })
    expect(await prisma.bgmLibrary.count({ where: { folder: PROJECT, name: '歌曲A' } })).toBe(1)
  })

  it('非法媒体扩展 → 400 且零写入', async () => {
    const form = makeForm({ projectName: PROJECT2 })
    form.append('imageFiles', new File([new Uint8Array([1])], 'evil.exe'))
    const res = await call(form)
    expect(res.status).toBe(400)
    expect(await prisma.stockAsset.count({ where: { folder: PROJECT2 } })).toBe(0)
    expect(await prisma.bgmLibrary.count({ where: { folder: PROJECT2 } })).toBe(0)
  })

  it('框架名为空 → 400', async () => {
    const res = await call(makeForm({ name: ' ' }))
    expect(res.status).toBe(400)
  })

  it('带 watermark/bodyCount → 落到 overlayTemplate.watermark 与 suggestedSegmentCount', async () => {
    const form = makeForm({ projectName: '导入测试工程3' })
    form.set('watermark', '@欧子好读')
    form.set('bodyCount', '4')
    const res = await call(form)
    expect(res.status).toBe(200)
    const j = await res.json()
    createdFw.push(j.id)
    await trackBgm('导入测试工程3')
    await trackAsset('导入测试工程3')
    const fw = await prisma.copyFramework.findUniqueOrThrow({ where: { id: j.id } })
    expect((fw.overlayTemplate as Record<string, unknown>).watermark).toBe('@欧子好读')
    expect(fw.suggestedSegmentCount).toBe(4)
  })

  it('不带这两个字段 → 与现状一致（不写入）', async () => {
    const res = await call(makeForm({ projectName: '导入测试工程4' }))
    const j = await res.json()
    createdFw.push(j.id)
    await trackBgm('导入测试工程4')
    await trackAsset('导入测试工程4')
    const fw = await prisma.copyFramework.findUniqueOrThrow({ where: { id: j.id } })
    expect((fw.overlayTemplate as Record<string, unknown>).watermark).toBeUndefined()
    expect(fw.suggestedSegmentCount).toBeNull()
  })

  it('带 flashCount → 落到 overlayTemplate.__bookCount（供 resolveBookCount 读取，供快闪书封配齐用）', async () => {
    // 用独立 userId，避免与本文件其它用例共用 'op1' 撞上 jianying-import 的每用户限流
    requireRoleMock.mockResolvedValueOnce({ userId: 'op-flashcount-1', role: 'operator' })
    const form = makeForm({ projectName: '导入测试工程5' })
    form.set('flashCount', '13')
    const res = await call(form)
    expect(res.status).toBe(200)
    const j = await res.json()
    createdFw.push(j.id)
    await trackBgm('导入测试工程5')
    await trackAsset('导入测试工程5')
    const fw = await prisma.copyFramework.findUniqueOrThrow({ where: { id: j.id } })
    expect((fw.overlayTemplate as Record<string, unknown>).__bookCount).toBe(13)
  })

  it('不带 flashCount → __bookCount 不写入（与现状一致，零回归）', async () => {
    requireRoleMock.mockResolvedValueOnce({ userId: 'op-flashcount-2', role: 'operator' })
    const res = await call(makeForm({ projectName: '导入测试工程6' }))
    const j = await res.json()
    createdFw.push(j.id)
    await trackBgm('导入测试工程6')
    await trackAsset('导入测试工程6')
    const fw = await prisma.copyFramework.findUniqueOrThrow({ where: { id: j.id } })
    expect((fw.overlayTemplate as Record<string, unknown>).__bookCount).toBeUndefined()
  })

  it('flashCount 非法(0/负数/非数字) → 不写入(不写 0/NaN)', async () => {
    for (const bad of ['0', '-1', 'abc']) {
      requireRoleMock.mockResolvedValueOnce({ userId: `op-flashcount-bad-${bad}`, role: 'operator' })
      const form = makeForm({ projectName: `导入测试工程7-${bad}` })
      form.set('flashCount', bad)
      const res = await call(form)
      expect(res.status).toBe(200)
      const j = await res.json()
      createdFw.push(j.id)
      await trackBgm(`导入测试工程7-${bad}`)
      await trackAsset(`导入测试工程7-${bad}`)
      const fw = await prisma.copyFramework.findUniqueOrThrow({ where: { id: j.id } })
      expect((fw.overlayTemplate as Record<string, unknown>).__bookCount).toBeUndefined()
    }
  })

  it('导入的图片素材同时生成 .thumb.webp 缩略图（否则该素材永远回退原图，Task 5 的性能优化不适用于剪映导入的图库）', async () => {
    requireRoleMock.mockResolvedValueOnce({ userId: 'op-thumb-1', role: 'operator' })
    const form = makeForm({ projectName: '导入测试工程-缩略图' })
    // 替换掉默认桩图片,换成真实可解码的 png
    form.delete('imageFiles')
    form.append('imageFiles', new File([await realPngBytes('green')], 'pic.png', { type: 'image/png' }))
    const res = await call(form)
    expect(res.status).toBe(200)
    const j = await res.json()
    createdFw.push(j.id)
    await trackBgm('导入测试工程-缩略图')
    const asset = await prisma.stockAsset.findFirstOrThrow({ where: { folder: '导入测试工程-缩略图', name: 'pic' } })
    createdAssets.push(asset.id)
    const thumbAbs = path.join(tmpDataDir, 'assets', `${asset.id}.thumb.webp`)
    const stat = await fs.stat(thumbAbs)
    expect(stat.size).toBeGreaterThan(0)
  })

  it('图片无法被 ffmpeg 解码（makeThumb 失败）时，导入本身仍成功（缩略图失败不拖垮批量导入）', async () => {
    requireRoleMock.mockResolvedValueOnce({ userId: 'op-thumb-2', role: 'operator' })
    const form = makeForm({ projectName: '导入测试工程-缩略图失败' })
    form.delete('imageFiles')
    // 扩展名/MIME 都合法但内容是随机字节，ffmpeg 解码必然失败。
    const garbage = Buffer.from(Array.from({ length: 500 }, () => Math.floor(Math.random() * 256)))
    form.append('imageFiles', new File([garbage], 'bad.png', { type: 'image/png' }))
    const res = await call(form)
    expect(res.status).toBe(200)
    const j = await res.json()
    createdFw.push(j.id)
    await trackBgm('导入测试工程-缩略图失败')
    expect(j.assets).toEqual({ imported: 1, reused: 0 })
    const asset = await prisma.stockAsset.findFirstOrThrow({ where: { folder: '导入测试工程-缩略图失败', name: 'bad' } })
    createdAssets.push(asset.id)
  })

  it('带 draftJson → 服务端权威重算保真度报告并落库到 draftFidelityReport', async () => {
    requireRoleMock.mockResolvedValueOnce({ userId: 'op-fidelity-1', role: 'operator' })
    const form = makeForm({ projectName: '导入测试工程-保真度', draftJson: JSON.stringify(SAMPLE_DRAFT) })
    const res = await call(form)
    expect(res.status).toBe(200)
    const j = await res.json()
    createdFw.push(j.id)
    await trackBgm('导入测试工程-保真度')
    await trackAsset('导入测试工程-保真度')
    const fw = await prisma.copyFramework.findUniqueOrThrow({ where: { id: j.id } })
    const report = fw.draftFidelityReport as {
      parsedAt: string
      summary: { extracted: number; defaulted: number; unsupported: number }
      entries: unknown[]
    }
    expect(report).toBeTruthy()
    expect(typeof report.parsedAt).toBe('string')
    expect(typeof report.summary.extracted).toBe('number')
    expect(typeof report.summary.defaulted).toBe('number')
    expect(typeof report.summary.unsupported).toBe('number')
    expect(Array.isArray(report.entries)).toBe(true)
    expect(report.entries.length).toBeGreaterThan(0)
  })

  it('不带 draftJson → draftFidelityReport 为 null（与现状一致，零回归）', async () => {
    requireRoleMock.mockResolvedValueOnce({ userId: 'op-fidelity-2', role: 'operator' })
    const res = await call(makeForm({ projectName: '导入测试工程-无草稿' }))
    expect(res.status).toBe(200)
    const j = await res.json()
    createdFw.push(j.id)
    await trackBgm('导入测试工程-无草稿')
    await trackAsset('导入测试工程-无草稿')
    const fw = await prisma.copyFramework.findUniqueOrThrow({ where: { id: j.id } })
    expect(fw.draftFidelityReport).toBeNull()
  })
})
