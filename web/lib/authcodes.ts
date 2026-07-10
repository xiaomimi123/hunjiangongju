import { randomInt, createHash } from 'crypto'

export function isEmail(s: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s ?? '')
}

export function genCode(): string {
  return String(randomInt(100000, 1000000))
}

export function hashCode(code: string): string {
  return createHash('sha256').update(String(code)).digest('hex')
}
