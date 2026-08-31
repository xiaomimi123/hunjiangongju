import { NextResponse } from 'next/server'
import { signToken } from './jwt'

export async function setSessionCookie(
  res: NextResponse,
  session: { userId: string; role: string }
): Promise<NextResponse> {
  const token = await signToken(session)
  res.cookies.set('token', token, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 7 * 24 * 3600,
    // 生产是 HTTPS（Caddy），条件为 NODE_ENV==='production' 而非无条件 true：
    // 本地开发跑在 http://localhost，无条件加 Secure 会让浏览器拒收 cookie，本地登录不了。
    secure: process.env.NODE_ENV === 'production',
  })
  return res
}
