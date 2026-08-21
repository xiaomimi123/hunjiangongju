// 图片槽位配置：每个正片图片位单独指定来源（AI 生图 / 素材库随机）与提示词。
//
// 为什么需要固定槽位数：现状的正片图片数 = 文案句数，文案长短会让每条片子的图片数变化，
// 「第 3 张图」在不同片子里对应不同位置，逐槽配置无从谈起。槽位数由草稿的正片 photo 段数锁定，
// 文案反过来被规整成这个段数（见 fitSegments.ts）。
//
// 画风默认来自框架的 imageStylePrompt，逐槽 prompt 只管「画什么」——这样改一次画风
// 所有槽位一起变。但同一条片子里确实会出现「开场卡通人物头像、后面达芬奇」这种需求，
// 所以额外给每个槽位开了 style 覆盖；留空即沿用框架全局画风。

export interface ImageSlot {
  index: number
  source: 'ai' | 'library'
  /** source==='ai' 时的主体提示词；留空则回退 artScenes 场景池 */
  prompt?: string
  /** source==='ai' 时覆盖本槽位画风；留空则用框架的 imageStylePrompt */
  style?: string
  /** source==='library' 时限定素材文件夹；留空则全库 */
  folder?: string
  /**
   * 参考图（DATA_DIR 下的相对路径，如 `refs/xxx.png`）。
   *
   * 与 style 的区别：style 是**文字**描述的画风，参考图是**图本身**参与生成
   * （qwen-image-3.0 的 content 支持同时给 image 与 text）。
   * 文字描述必然丢信息——同一句「日系动漫画风」能画出天差地别的东西；
   * 带上原图让模型直接沿用它的笔触与配色，比任何描述都准。两者可以并用。
   */
  refImage?: string
}

export interface ImageSlotConfig {
  count: number
  slots: ImageSlot[]
}

function obj(x: unknown): Record<string, unknown> {
  return x && typeof x === 'object' && !Array.isArray(x) ? (x as Record<string, unknown>) : {}
}

/**
 * 从 overlayTemplate 读槽位配置。脏项静默丢弃而非让整块配置失效——
 * 运营可能手改 JSON，一个字段写错不该让所有槽位回退。
 * 未配置或 count 非法 → null（调用方维持现状行为）。
 */
export function readImageSlots(overlayTemplate: unknown): ImageSlotConfig | null {
  const raw = obj(obj(overlayTemplate).__imageSlots)
  const count = raw.count
  if (typeof count !== 'number' || !Number.isInteger(count) || count <= 0) return null

  const slots: ImageSlot[] = []
  for (const item of Array.isArray(raw.slots) ? raw.slots : []) {
    const s = obj(item)
    const index = s.index
    const source = s.source
    if (typeof index !== 'number' || !Number.isInteger(index) || index < 0 || index >= count) continue
    if (source !== 'ai' && source !== 'library') continue
    slots.push({
      index,
      source,
      ...(typeof s.prompt === 'string' && s.prompt.trim() ? { prompt: s.prompt.trim() } : {}),
      ...(typeof s.style === 'string' && s.style.trim() ? { style: s.style.trim() } : {}),
      ...(typeof s.folder === 'string' && s.folder.trim() ? { folder: s.folder.trim() } : {}),
      ...(typeof s.refImage === 'string' && s.refImage.trim() ? { refImage: s.refImage.trim() } : {}),
    })
  }
  return { count, slots }
}

/** 取某个下标的槽位配置；未配置返回 undefined（调用方走默认行为） */
export function slotAt(cfg: ImageSlotConfig | null, index: number): ImageSlot | undefined {
  return cfg?.slots.find((s) => s.index === index)
}

/**
 * 开场碎裂用的那张图 —— **它有自己的槽位，不占用正片第 1 张**。
 *
 * 原先渲染层直接取 `images[0]`（正片第 1 张）当开场底图。后果是「开场卡通人物头像」
 * 和「正片艺术画风」二选一：把第 1 槽配成头像，正片第一段也会变成那张头像。
 * 而草稿里开场本来就是独立素材（客户样例是一段 .mov），与正片分开。
 *
 * 留空表示不单独生成，渲染层回退到正片第 1 张——老框架零回归。
 */
export interface OpenImageConfig {
  /** 主体提示词。留空则用「人物特写」这类由 style 决定的默认主体 */
  prompt?: string
  /** 画风。留空则沿用框架的 imageStylePrompt */
  style?: string
  /** 参考图（DATA_DIR 下的相对路径）。见 ImageSlot.refImage */
  refImage?: string
}

export function readOpenImage(overlayTemplate: unknown): OpenImageConfig | null {
  const raw = obj(obj(overlayTemplate).__openImage)
  const prompt = typeof raw.prompt === 'string' ? raw.prompt.trim() : ''
  const style = typeof raw.style === 'string' ? raw.style.trim() : ''
  const refImage = typeof raw.refImage === 'string' ? raw.refImage.trim() : ''
  // 三个字段都空 = 没配。空对象不该让渲染层以为"配了但内容为空"而生成一张默认图
  if (!prompt && !style && !refImage) return null
  return {
    ...(prompt ? { prompt } : {}),
    ...(style ? { style } : {}),
    ...(refImage ? { refImage } : {}),
  }
}
