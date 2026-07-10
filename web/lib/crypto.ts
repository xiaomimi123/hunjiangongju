import { scryptSync, randomBytes, createCipheriv, createDecipheriv } from 'crypto'

const key = () => scryptSync(process.env.JWT_SECRET ?? 'dev-secret', 'mixcut-smtp-salt', 32)

export function encrypt(plain: string): string {
  if (!plain) return ''
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key(), iv)
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return Buffer.concat([iv, tag, enc]).toString('base64')
}

export function decrypt(data: string): string {
  if (!data) return ''
  const buf = Buffer.from(data, 'base64')
  const iv = buf.subarray(0, 12)
  const tag = buf.subarray(12, 28)
  const enc = buf.subarray(28)
  const decipher = createDecipheriv('aes-256-gcm', key(), iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8')
}
