import { describe, it, expect, afterEach, vi } from 'vitest'
import { NextResponse } from 'next/server'
import { setSessionCookie } from './session'

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('setSessionCookie 的 Secure 属性', () => {
  it('生产环境（NODE_ENV=production）下 cookie 带 Secure', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('JWT_SECRET', 'test-secret-for-production-cookie-check')
    const res = await setSessionCookie(NextResponse.json({ ok: true }), { userId: 'u1', role: 'student' })
    const setCookie = res.headers.get('set-cookie') ?? ''
    expect(setCookie).toContain('Secure')
  })

  it('非生产环境下 cookie 不带 Secure（本地 http://localhost 开发需要能登录）', async () => {
    vi.stubEnv('NODE_ENV', 'test')
    const res = await setSessionCookie(NextResponse.json({ ok: true }), { userId: 'u1', role: 'student' })
    const setCookie = res.headers.get('set-cookie') ?? ''
    expect(setCookie).not.toContain('Secure')
  })

  it('cookie 仍然保留 HttpOnly / SameSite=lax / Path=/', async () => {
    vi.stubEnv('NODE_ENV', 'test')
    const res = await setSessionCookie(NextResponse.json({ ok: true }), { userId: 'u1', role: 'student' })
    const setCookie = res.headers.get('set-cookie') ?? ''
    expect(setCookie).toContain('HttpOnly')
    expect(setCookie.toLowerCase()).toContain('samesite=lax')
    expect(setCookie).toContain('Path=/')
  })
})
