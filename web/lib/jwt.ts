import { SignJWT, jwtVerify } from 'jose'

// epoch：会话代次，改密码 / 重置密码时 +1。旧 token（部署前签发的）没有这个 claim，
// verifyToken 把「缺失」当作 epoch=0 处理，与数据库列默认值对齐，保证存量登录不受影响。
export type Session = { userId: string; role: string; epoch: number }
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
    // 存量 token（部署本次改动前签发）没有 epoch claim，按 0 处理，与 User.sessionEpoch 默认值对齐
    const epoch = typeof payload.epoch === 'number' ? payload.epoch : 0
    return { userId: payload.userId, role: payload.role, epoch }
  } catch {
    return null
  }
}
