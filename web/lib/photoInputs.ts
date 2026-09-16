// AI 实拍生图：学员提交的运行参数校验（web 第一道闸；worker 侧路径复验是第二道）。
import { HttpError } from './auth'

export const PHOTO_MODES = ['cover', 'inner'] as const
export type PhotoMode = (typeof PHOTO_MODES)[number]

const COVER_SHOTS = new Set(['auto', 'lap_front', 'angled_pageblock', 'slightly_open', 'dark_fabric_close', 'desk_props'])
const INNER_STYLES = new Set(['S01', 'S02'])

// UUID 落盘命名 + 白名单扩展名：与 upload 路由写盘规则、worker 的 INPUT_REL_RE 三处一致
export const INPUT_REL_RE = /^photo-uploads\/[0-9a-f-]{36}\.(jpg|jpeg|png|webp)$/

export const MAX_COUNT = 4

export type PhotoRunParams = {
  mode: PhotoMode
  shotMode: string | null
  style: string | null
  count: number
  inputImage: string
}

export function validatePhotoRun(body: unknown): PhotoRunParams {
  const b = body && typeof body === 'object' ? (body as Record<string, unknown>) : {}
  const mode = b.mode
  if (mode !== 'cover' && mode !== 'inner') throw new HttpError(400, 'mode 必须是 cover 或 inner')

  let shotMode: string | null = null
  let style: string | null = null
  if (mode === 'cover') {
    shotMode = typeof b.shotMode === 'string' ? b.shotMode : 'auto'
    if (!COVER_SHOTS.has(shotMode)) throw new HttpError(400, `拍法「${shotMode}」不在可选范围`)
  } else {
    style = typeof b.style === 'string' ? b.style : 'S01'
    if (!INNER_STYLES.has(style)) throw new HttpError(400, `风格「${style}」不在可选范围`)
  }

  const count = b.count
  if (typeof count !== 'number' || !Number.isInteger(count) || count < 1 || count > MAX_COUNT) {
    throw new HttpError(400, `生成张数必须是 1-${MAX_COUNT} 的整数`)
  }

  const inputImage = typeof b.inputImage === 'string' ? b.inputImage : ''
  if (!INPUT_REL_RE.test(inputImage)) throw new HttpError(400, '请先拍摄或上传一张书籍照片')

  return { mode, shotMode, style, count, inputImage }
}

// 单张积分价：从 photo 能力的 extra.pricePerImage 读，缺省 1。支持小数（如 0.5）——
// 账本仍是整数积分，总价 = ceil(单价×张数)（见 totalPhotoPrice），多拍更划算。
export function resolvePricePerImage(extra: Record<string, unknown>): number {
  const raw = extra.pricePerImage
  if (typeof raw === 'number' && Number.isFinite(raw) && raw >= 0 && raw <= 100) return raw
  return 1
}

// 一次运行的总扣分：小数单价向上取整成整数积分（0.5×1张=1分、0.5×4张=2分）
export function totalPhotoPrice(pricePerImage: number, count: number): number {
  return Math.ceil(pricePerImage * count)
}
