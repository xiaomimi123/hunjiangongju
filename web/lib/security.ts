import type { NextRequest } from 'next/server'
import { HttpError } from './auth'

export const MIN_PASSWORD = 8

// 统一的密码强度校验（注册 / 重置 / 修改 / 管理员重置都用它）
export function assertPassword(pw: unknown): asserts pw is string {
  if (typeof pw !== 'string' || pw.length < MIN_PASSWORD) {
    throw new HttpError(400, `密码至少 ${MIN_PASSWORD} 位`)
  }
}

// 取客户端真实 IP：生产在 Caddy 之后，优先 X-Forwarded-For 首个地址
export function clientIp(req: NextRequest): string {
  const xff = req.headers.get('x-forwarded-for')
  if (xff) return xff.split(',')[0].trim()
  return req.headers.get('x-real-ip') || 'unknown'
}

// 注册去掉昵称后，由系统按邮箱前缀生成一个默认昵称
export function nicknameFromEmail(email: string): string {
  const local = String(email).split('@')[0] || '学员'
  return local.slice(0, 20)
}
