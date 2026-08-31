import { cookies } from 'next/headers'
import { prisma } from '@mixcut/db'
import { verifyToken, type Session } from './jwt'

export class HttpError extends Error {
  // code：机器可读错误码（如 NO_CREDITS），前端据此走专门 UI；缺省只有人读文案
  constructor(public status: number, message: string, public code?: string) {
    super(message)
  }
}

// 只验 JWT 签名，不查库——文件下载等极轻量路由用它判断"有没有登录"。
// 不做禁用 / 改密码踢人的收口，需要这些保证的地方一律用 requireRole。
export async function getSession(): Promise<Session | null> {
  const token = cookies().get('token')?.value
  return token ? verifyToken(token) : null
}

// requireRole 会回查数据库（每次调用一次 findUnique），这是刻意的取舍：
// 换来「改密码 / 禁用账号能让旧会话立即失效」，代价是数据库挂了会让所有 API 401/500，
// 而不再是仅数据接口失败。role 以数据库当前值为准，不信 token 里的（token 签发后角色可能已变）。
//
// 已知边界：web/middleware.ts 跑在 Edge 运行时用不了 Prisma，仍然只验 JWT 签名——
// 被禁用 / 踢会话的用户还能加载页面外壳（middleware 放行），但任何 API 调用都会在这里 401。
// 这是可接受的取舍，不是 bug。
export async function requireRole(role?: 'operator'): Promise<Session> {
  const s = await getSession()
  if (!s) throw new HttpError(401, '未登录')
  const user = await prisma.user.findUnique({
    where: { id: s.userId },
    select: { id: true, role: true, disabled: true, sessionEpoch: true },
  })
  if (!user) throw new HttpError(401, '未登录')
  if (user.disabled) throw new HttpError(401, '账号已被禁用')
  // token 里没有 epoch（存量登录，部署本次改动前签发）时 verifyToken 已归一为 0，
  // 与 sessionEpoch 默认值 0 对齐，因此存量会话在这里天然放行，不会被误踢。
  if (user.sessionEpoch !== s.epoch) throw new HttpError(401, '登录状态已失效，请重新登录')
  if (role && user.role !== role) throw new HttpError(403, '无权限')
  return { userId: user.id, role: user.role, epoch: user.sessionEpoch }
}
