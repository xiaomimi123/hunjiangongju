import { SignJWT, jwtVerify } from 'jose'

export type Session = { userId: string; role: string }
const secret = () => {
  const value = process.env.JWT_SECRET
  if (!value) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('JWT_SECRET 未设置')
    }
    return new TextEncoder().encode('dev-secret')
  }
  return new TextEncoder().encode(value)
}

export async function signToken(s: Session): Promise<string> {
  return new SignJWT(s)
    .setProtectedHeader({ alg: 'HS256' })
    .setExpirationTime('7d')
    .sign(secret())
}

export async function verifyToken(token: string): Promise<Session | null> {
  try {
    const { payload } = await jwtVerify(token, secret(), { algorithms: ['HS256'] })
    if (typeof payload.userId !== 'string' || typeof payload.role !== 'string') return null
    return { userId: payload.userId, role: payload.role }
  } catch {
    return null
  }
}
