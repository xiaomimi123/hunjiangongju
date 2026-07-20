import { createHmac } from 'crypto'

function secret() {
  const s = process.env.ASSET_URL_SECRET
  if (!s) throw new Error('ASSET_URL_SECRET 未配置')
  return s
}
// token = `${expiryMs}.${hmac(relPath|expiryMs)}`
export function signAssetPath(relPath: string, ttlSec: number, now: number): string {
  const expiry = now + ttlSec * 1000
  const mac = createHmac('sha256', secret()).update(`${relPath}|${expiry}`).digest('hex').slice(0, 32)
  return `${expiry}.${mac}`
}
export function verifyAssetToken(relPath: string, token: string, now: number): boolean {
  const [expStr, mac] = token.split('.')
  const expiry = Number(expStr)
  if (!Number.isFinite(expiry) || now > expiry) return false
  const expect = createHmac('sha256', secret()).update(`${relPath}|${expiry}`).digest('hex').slice(0, 32)
  return mac === expect
}
export function publicAssetUrl(relPath: string, ttlSec = 3600): string {
  const base = process.env.PUBLIC_BASE_URL
  if (!base) throw new Error('PUBLIC_BASE_URL 未配置')
  const tok = signAssetPath(relPath, ttlSec, Date.now())
  return `${base.replace(/\/$/, '')}/api/files/${relPath}?sig=${encodeURIComponent(tok)}`
}
