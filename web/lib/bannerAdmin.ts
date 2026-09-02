// Banner 后台校验：title/body/linkUrl/sortOrder 的合法性判断，供新建/编辑复用。
import { HttpError } from './auth'

// linkUrl 若给出，必须是站内路径（/ 开头）或 https 外链，避免 http/javascript: 等不安全协议。
const LINK_URL_RE = /^(\/|https:\/\/)/

export function validateTitle(raw: unknown): string {
  const title = typeof raw === 'string' ? raw.trim() : ''
  if (title.length < 1 || title.length > 60) throw new HttpError(400, 'title 长度必须在 1~60 之间')
  return title
}

export function validateBody(raw: unknown): string {
  const body = typeof raw === 'string' ? raw : ''
  if (body.length > 200) throw new HttpError(400, 'body 长度不能超过 200')
  return body
}

export function validateLinkUrl(raw: unknown): string | null {
  if (raw === undefined || raw === null || raw === '') return null
  if (typeof raw !== 'string' || !LINK_URL_RE.test(raw)) {
    throw new HttpError(400, 'linkUrl 必须是 / 开头的站内路径或 https 开头的外链')
  }
  return raw
}

export function validateSortOrder(raw: unknown): number {
  if (!Number.isInteger(raw) || (raw as number) < 0 || (raw as number) > 999) {
    throw new HttpError(400, 'sortOrder 必须是 0~999 之间的整数')
  }
  return raw as number
}
