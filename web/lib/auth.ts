import { cookies } from 'next/headers'
import { verifyToken, type Session } from './jwt'

export class HttpError extends Error {
  // code：机器可读错误码（如 NO_CREDITS），前端据此走专门 UI；缺省只有人读文案
  constructor(public status: number, message: string, public code?: string) {
    super(message)
  }
}

export async function getSession(): Promise<Session | null> {
  const token = cookies().get('token')?.value
  return token ? verifyToken(token) : null
}

export async function requireRole(role?: 'operator'): Promise<Session> {
  const s = await getSession()
  if (!s) throw new HttpError(401, '未登录')
  if (role && s.role !== role) throw new HttpError(403, '无权限')
  return s
}
