import { cookies } from 'next/headers'
import { verifyToken, type Session } from './jwt'

export class HttpError extends Error {
  constructor(public status: number, message: string) {
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
