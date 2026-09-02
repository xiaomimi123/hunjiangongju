import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import { NextRequest } from 'next/server'
import os from 'os'
import path from 'path'
import fs from 'fs/promises'
import { mkdtempSync } from 'fs'
import { HttpError } from '@/lib/auth'

// 与 web/lib/cozeInputs.ts 里 IMAGE_REL_RE 完全一致——上传落盘的命名规则和 run 路由校验的
// 正则必须闭环，这里独立复制一份正则做断言（而不是 import 私有常量），验证的是"两处约定一致"。
const IMAGE_REL_RE = /^coze-uploads\/[0-9a-f-]{36}\.(jpg|jpeg|png|webp)$/

// DATA_DIR 在路由模块加载时被 web/lib/paths.ts 读一次，必须在 import 路由前设好，
// 指向临时目录（测试结束整体清理），照 admin/fonts/route.test.ts 的既有写法。
const tmpDataDir = mkdtempSync(path.join(os.tmpdir(), 'coze-upload-route-test-'))
process.env.DATA_DIR = tmpDataDir

const requireRoleMock = vi.fn()
vi.mock('@/lib/auth', async () => {
  const actual = await vi.importActual<typeof import('@/lib/auth')>('@/lib/auth')
  return { ...actual, requireRole: (...args: unknown[]) => requireRoleMock(...args) }
})

let POST: typeof import('./route').POST
beforeAll(async () => {
  ;({ POST } = await import('./route'))
})

afterAll(async () => {
  await fs.rm(tmpDataDir, { recursive: true, force: true })
})

function fileReq(fd: FormData) {
  return new NextRequest('http://localhost/api/tools/upload', { method: 'POST', body: fd })
}

describe('POST /api/tools/upload', () => {
  it('未登录 → 401', async () => {
    requireRoleMock.mockRejectedValueOnce(new HttpError(401, '未登录'))
    const fd = new FormData()
    fd.append('file', new File([Buffer.from('x')], 'a.png', { type: 'image/png' }))
    const res = await POST(fileReq(fd), { params: {} })
    expect(res.status).toBe(401)
  })

  it('非白名单扩展名（伪装成图片的可执行文件）→ 400', async () => {
    requireRoleMock.mockResolvedValue({ userId: 'stu-upload-1', role: 'student' })
    const fd = new FormData()
    // path.extname 取的是最后一段：'x.png.exe' → '.exe'，不在白名单内
    fd.append('file', new File([Buffer.from('MZ...')], 'x.png.exe'))
    const res = await POST(fileReq(fd), { params: {} })
    expect(res.status).toBe(400)
  })

  it('.gif 等未在白名单里的图片格式 → 400', async () => {
    requireRoleMock.mockResolvedValue({ userId: 'stu-upload-1', role: 'student' })
    const fd = new FormData()
    fd.append('file', new File([Buffer.from('GIF89a')], 'a.gif', { type: 'image/gif' }))
    const res = await POST(fileReq(fd), { params: {} })
    expect(res.status).toBe(400)
  })

  it('超过 10MB → 400', async () => {
    requireRoleMock.mockResolvedValue({ userId: 'stu-upload-1', role: 'student' })
    const fd = new FormData()
    fd.append('file', new File([Buffer.alloc(10 * 1024 * 1024 + 1)], 'big.png', { type: 'image/png' }))
    const res = await POST(fileReq(fd), { params: {} })
    expect(res.status).toBe(400)
  })

  it('合法上传 → 200，rel 匹配 IMAGE_REL_RE（与 run 路由的校验正则闭环），落盘文件确实存在且文件名是 UUID', async () => {
    requireRoleMock.mockResolvedValue({ userId: 'stu-upload-2', role: 'student' })
    const fd = new FormData()
    fd.append('file', new File([Buffer.from([137, 80, 78, 71])], 'photo.png', { type: 'image/png' }))
    const res = await POST(fileReq(fd), { params: {} })
    expect(res.status).toBe(200)
    const { rel } = await res.json()
    expect(rel).toMatch(IMAGE_REL_RE)

    const abs = path.join(tmpDataDir, rel)
    const stat = await fs.stat(abs)
    expect(stat.isFile()).toBe(true)
  })

  it('限流：超过 20 次/分钟 → 429', async () => {
    requireRoleMock.mockResolvedValue({ userId: 'stu-upload-ratelimit', role: 'student' })
    let last: Response | undefined
    for (let i = 0; i < 21; i++) {
      const fd = new FormData()
      fd.append('file', new File([Buffer.from([137, 80, 78, 71])], 'photo.png', { type: 'image/png' }))
      last = await POST(fileReq(fd), { params: {} })
    }
    expect(last?.status).toBe(429)
  })
})
