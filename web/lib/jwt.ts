import { SignJWT, jwtVerify } from 'jose'

export type Session = { userId: string; role: string }
const secret = () => new TextEncoder().encode(process.env.JWT_SECRET ?? 'dev-secret')

export async function signToken(s: Session): Promise<string> {
  return new SignJWT(s)
    .setProtectedHeader({ alg: 'HS256' })
    .setExpirationTime('7d')
    .sign(secret())
}

export async function verifyToken(token: string): Promise<Session | null> {
  try {
    const { payload } = await jwtVerify(token, secret())
    if (typeof payload.userId !== 'string' || typeof payload.role !== 'string') return null
    return { userId: payload.userId, role: payload.role }
  } catch {
    return null
  }
}
