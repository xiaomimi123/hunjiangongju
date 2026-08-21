// 缩略图缺失时回退到原图。
//
// 背景：thumbUrl() 是**纯字符串推导**（`x.png` → `x.thumb.webp`），页面只要拿到原图 URL
// 就一定会去请求缩略图。而缩略图是「锦上添花」的产物——剪映批量导入时 makeThumb 失败
// 只记一条 warning（不能让一张坏图拖垮整批导入），老素材更是在这个功能之前入的库。
// 结果就是素材库页面刷一屏 404。
//
// 修在文件服务这一层而不是逐个页面加 onError：一处修好，素材库/生成网格/编辑页全都受益，
// 以后新加的页面天然是对的。代价是缺缩略图时传的是原图（慢一点），
// 但「慢一点」远好过「裂图」。

/** 缩略图后缀。与 thumbUrl() 保持一致，改这里必须同步改那边。 */
export const THUMB_SUFFIX = '.thumb.webp'

/** 可能的原图扩展名。缩略图名里看不出原图是什么格式，只能逐个试。 */
const ORIGINAL_EXTS = ['.png', '.jpg', '.jpeg', '.webp']

/**
 * 请求的是缩略图但它不存在时，找出可以顶上的原图。
 *
 * **只对 `.thumb.webp` 生效**：普通文件缺失必须照常 404，
 * 绝不能悄悄换成一个同名不同扩展名的文件返回。
 *
 * @param rel 请求的相对路径
 * @param exists 判断某个相对路径是否存在（注入以便测试，不碰真实 fs）
 * @returns 可用的原图相对路径；不是缩略图请求、或找不到原图时返回 null
 */
export function fallbackOriginal(rel: string, exists: (p: string) => boolean): string | null {
  if (!rel.endsWith(THUMB_SUFFIX)) return null
  const base = rel.slice(0, -THUMB_SUFFIX.length)
  if (!base) return null
  for (const ext of ORIGINAL_EXTS) {
    const candidate = base + ext
    if (exists(candidate)) return candidate
  }
  return null
}
