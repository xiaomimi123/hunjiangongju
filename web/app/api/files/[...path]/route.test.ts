import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import { NextRequest } from 'next/server'
import os from 'os'
import path from 'path'
import fs from 'fs/promises'

// 路由内部通过 DATA_DIR 常量落盘/读取，需在导入路由前设好，指向临时目录（测试结束整体清理）。
const tmpDataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'files-route-test-'))
process.env.DATA_DIR = tmpDataDir

const getSessionMock = vi.fn()
vi.mock('@/lib/auth', async () => {
  const actual = await vi.importActual<typeof import('@/lib/auth')>('@/lib/auth')
  return { ...actual, getSession: (...args: unknown[]) => getSessionMock(...args) }
})

const { GET } = await import('./route')

const REL = 'gen/a/final.png'
const CONTENT = Buffer.from('hello world image bytes')

beforeAll(async () => {
  await fs.mkdir(path.join(tmpDataDir, 'gen', 'a'), { recursive: true })
  await fs.writeFile(path.join(tmpDataDir, REL), CONTENT)
})

afterAll(async () => {
  await fs.rm(tmpDataDir, { recursive: true, force: true })
})

function req(url: string, headers?: Record<string, string>) {
  return new NextRequest(url, { headers })
}

describe('GET /api/files/[...path]', () => {
  it('未登录且无 sig → 401（回归，鉴权不得被缓存逻辑绕过）', async () => {
    getSessionMock.mockResolvedValueOnce(null)
    const res = await GET(req(`http://localhost/api/files/${REL}`), { params: { path: REL.split('/') } })
    expect(res.status).toBe(401)
  })

  it('未登录 + 携带 If-None-Match → 仍是 401，不能靠条件请求绕过登录得到 304', async () => {
    getSessionMock.mockResolvedValueOnce(null)
    const res = await GET(
      req(`http://localhost/api/files/${REL}`, { 'if-none-match': '"anything"' }),
      { params: { path: REL.split('/') } }
    )
    expect(res.status).toBe(401)
  })

  it('已登录 → 200 响应带 ETag、Last-Modified、Cache-Control 且含 private 与 immutable', async () => {
    getSessionMock.mockResolvedValueOnce({ userId: 'u1', role: 'operator' })
    const res = await GET(req(`http://localhost/api/files/${REL}`), { params: { path: REL.split('/') } })
    expect(res.status).toBe(200)
    const cacheControl = res.headers.get('cache-control') ?? ''
    expect(cacheControl).toContain('private')
    expect(cacheControl).toContain('immutable')
    expect(cacheControl).not.toContain('public')
    expect(res.headers.get('etag')).toBeTruthy()
    expect(res.headers.get('last-modified')).toBeTruthy()
  })

  it('带匹配的 If-None-Match → 304，且响应体为空', async () => {
    getSessionMock.mockResolvedValueOnce({ userId: 'u1', role: 'operator' })
    const first = await GET(req(`http://localhost/api/files/${REL}`), { params: { path: REL.split('/') } })
    const etag = first.headers.get('etag')!

    getSessionMock.mockResolvedValueOnce({ userId: 'u1', role: 'operator' })
    const res = await GET(
      req(`http://localhost/api/files/${REL}`, { 'if-none-match': etag }),
      { params: { path: REL.split('/') } }
    )
    expect(res.status).toBe(304)
    const body = await res.text()
    expect(body).toBe('')
  })

  it('带不匹配的 If-None-Match → 200 完整内容', async () => {
    getSessionMock.mockResolvedValueOnce({ userId: 'u1', role: 'operator' })
    const res = await GET(
      req(`http://localhost/api/files/${REL}`, { 'if-none-match': '"stale-etag-value"' }),
      { params: { path: REL.split('/') } }
    )
    expect(res.status).toBe(200)
    const body = await res.text()
    expect(body).toBe(CONTENT.toString())
  })

  it('If-Modified-Since 晚于 mtime → 304', async () => {
    getSessionMock.mockResolvedValueOnce({ userId: 'u1', role: 'operator' })
    const future = new Date(Date.now() + 60_000).toUTCString()
    const res = await GET(
      req(`http://localhost/api/files/${REL}`, { 'if-modified-since': future }),
      { params: { path: REL.split('/') } }
    )
    expect(res.status).toBe(304)
  })

  it('Range 请求仍返回 206 且 Content-Range 正确(回归)，同样带 ETag', async () => {
    getSessionMock.mockResolvedValueOnce({ userId: 'u1', role: 'operator' })
    const res = await GET(
      req(`http://localhost/api/files/${REL}`, { range: 'bytes=0-4' }),
      { params: { path: REL.split('/') } }
    )
    expect(res.status).toBe(206)
    expect(res.headers.get('content-range')).toBe(`bytes 0-4/${CONTENT.length}`)
    expect(res.headers.get('etag')).toBeTruthy()
    const cacheControl = res.headers.get('cache-control') ?? ''
    expect(cacheControl).toContain('private')
    const body = await res.text()
    expect(body).toBe(CONTENT.toString('utf-8', 0, 5))
  })
})
