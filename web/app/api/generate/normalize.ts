// 相对路径导入（而非 `@/` 别名）：本文件被 normalize.test.ts 用 vitest 直接测试，
// 该别名仅在 Next.js 构建时解析，vitest 未配置对应 resolve.alias
import { HttpError } from '../../../lib/auth'

type BookInput = { title: string; author?: string; points?: string }

// 手填书单模式下，服务端不信任客户端已 trim/校验过的书单，重新做一遍最小校验与清洗。
export function normalizeBooks(input: unknown): BookInput[] {
  if (!Array.isArray(input)) throw new HttpError(400, '书单格式错误，应为数组')
  const books: BookInput[] = []
  for (const raw of input) {
    if (!raw || typeof raw !== 'object') throw new HttpError(400, '书单格式错误')
    const title = typeof (raw as Record<string, unknown>).title === 'string' ? (raw as Record<string, unknown>).title as string : ''
    const t = title.trim()
    if (!t) continue // 空书名的行直接跳过（前端允许留空行占位）
    const authorRaw = (raw as Record<string, unknown>).author
    const pointsRaw = (raw as Record<string, unknown>).points
    const author = typeof authorRaw === 'string' && authorRaw.trim() ? authorRaw.trim() : undefined
    const points = typeof pointsRaw === 'string' && pointsRaw.trim() ? pointsRaw.trim() : undefined
    books.push({ title: t, ...(author ? { author } : {}), ...(points ? { points } : {}) })
  }
  if (books.length === 0) throw new HttpError(400, '书单模式下至少需要一本有效书名')
  return books
}

// 校验/清洗前端传来的 variables：手填书单模式下 books 需为合法数组，voiceId（若选了克隆音色）
// 须为非空字符串，其余字段原样透传。
export function normalizeVariables(variables: unknown): Record<string, unknown> | undefined {
  if (variables === undefined || variables === null) return undefined
  if (typeof variables !== 'object' || Array.isArray(variables)) throw new HttpError(400, '变量格式错误')
  const v = { ...(variables as Record<string, unknown>) }
  if ('books' in v) {
    v.books = normalizeBooks(v.books)
  }
  if ('voiceId' in v) {
    const voiceId = typeof v.voiceId === 'string' ? v.voiceId.trim() : ''
    if (voiceId) v.voiceId = voiceId
    else delete v.voiceId
  }
  // 文案来源：仅接受 manual/imitate，否则视为 auto（不设该字段，走全自动）。
  const mode = v.scriptMode
  if (mode === 'manual' || mode === 'imitate') {
    v.scriptMode = mode
    const cs = typeof v.customScript === 'string' ? v.customScript.trim() : ''
    if (!cs) throw new HttpError(400, '自定义/仿写模式需要提供文案')
    v.customScript = cs
  } else {
    delete v.scriptMode
    delete v.customScript
  }
  const bt = typeof v.bookTitle === 'string' ? v.bookTitle.trim() : ''
  if (bt) v.bookTitle = bt
  else delete v.bookTitle
  // 配图来源：仅接受 'library' 透传（素材库优先），其余（含缺省）一律不设该字段，走全 AI 生图。
  if (v.assetSource === 'library') {
    v.assetSource = 'library'
    const folder = typeof v.assetFolder === 'string' ? v.assetFolder.trim() : ''
    if (folder) v.assetFolder = folder
    else delete v.assetFolder
  } else {
    delete v.assetSource
    delete v.assetFolder
  }
  return v
}

// 非运营角色（学员等）一律使用默认音色：剥离 voice（火山克隆音色 id）与 voiceId（CosyVoice 克隆音色 id），
// 防止学员盗用运营的私有/付费克隆音色。运营角色原样保留；其余字段不受影响。
export function stripVoiceForNonOperator(
  role: string,
  variables: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (role === 'operator' || variables === undefined) return variables
  const v = { ...variables }
  delete v.voice
  delete v.voiceId
  return v
}
