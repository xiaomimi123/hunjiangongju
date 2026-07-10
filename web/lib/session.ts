import { NextResponse } from 'next/server'
import { signToken } from './jwt'

export async function setSessionCookie(
  res: NextResponse,
  session: { userId: string; role: string }
): Promise<NextResponse> {
  const token = await signToken(session)
  res.cookies.set('token', token, { httpOnly: true, sameSite: 'lax', path: '/', maxAge: 7 * 24 * 3600 })
  return res
}
