import { NextRequest, NextResponse } from 'next/server'
import { verifyToken } from './lib/jwt'

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl
  if (pathname.startsWith('/login') || pathname.startsWith('/api')) return NextResponse.next()
  const token = req.cookies.get('token')?.value
  const session = token ? await verifyToken(token) : null
  if (!session) return NextResponse.redirect(new URL('/login', req.url))
  if (pathname.startsWith('/admin') && session.role !== 'operator') {
    return NextResponse.redirect(new URL('/', req.url))
  }
  return NextResponse.next()
}

export const config = {
  // 排除静态资源（含 /fonts 下自托管字体），避免被鉴权拦截
  matcher: ['/((?!_next/static|_next/image|favicon.ico|fonts).*)'],
}
