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

/**
 * 非运营角色（学员等）的音色限制。
 *
 * 原先是**一律剥离** voice/voiceId，理由是防止盗用运营的私有/付费克隆音色。
 * 但学员端的正常流程就是「填书名 + 选配音」，一刀切等于把这个流程堵死。
 * 改成由**框架**声明哪些音色对学员开放：在名单里的放行，不在的照样剥离。
 *
 * **校验只认服务端读到的框架配置**，绝不信客户端传了什么。
 * voiceId（CosyVoice 克隆音色）仍然一律剥离——那条路径没有对应的框架级白名单，
 * 放开等于绕过这里的限制。
 *
 * @param allowedVoices 框架允许的音色 id；空数组即不开放，行为与改动前一致
 */
export function restrictVoiceForNonOperator(
  role: string,
  variables: Record<string, unknown> | undefined,
  allowedVoices: string[] = [],
): Record<string, unknown> | undefined {
  if (role === 'operator' || variables === undefined) return variables
  const v = { ...variables }
  delete v.voiceId
  const want = typeof v.voice === 'string' ? v.voice.trim() : ''
  if (!want || !allowedVoices.includes(want)) delete v.voice
  else v.voice = want
  return v
}
