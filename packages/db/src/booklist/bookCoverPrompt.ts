// 书单快闪的书封「底图」提示词：只出封面质感画面、居中留白给标题区、绝不含任何文字。
// 书名由标题字体叠字层渲染(见 flashMontage)，因此这里刻意不把书名放进正向提示。

export interface CoverPrompt { prompt: string; negativePrompt: string }

const COVER_NEG =
  '人, 人物, 人脸, 人像, person, people, human, face, portrait, ' +
  '文字, 字, 汉字, 字母, 单词, 书法, 标题, 作者名, 字幕, 水印, 条形码, ' +
  'text, letters, words, title, author, typography, caption, watermark, barcode, signature'

/**
 * @param styleHint 画风词，套进固定的「文艺封面底图」外壳（历史行为）
 * @param customPrompt 框架单独配置的**完整画面描述**（overlayTemplate.__coverPrompt）。
 *   给了它就不再用外壳——运营想要的书封画面可能根本不是"优雅抽象构图"那一套。
 *   但两条**功能性约束**必须保留，不归运营调：中央留白（书名标题要叠在上面）
 *   与禁文字（负向提示词同责）——丢了它们书名会和底图的字/图案糊在一起。
 */
export function buildBookCoverPrompt(
  book: { title: string; author?: string },
  styleHint?: string,
  customPrompt?: string,
): CoverPrompt {
  const custom = (customPrompt ?? '').trim()
  if (custom) {
    const prompt = [custom, '中央留出空白标题区, 3:4 portrait, no text'].join(', ')
    return { prompt, negativePrompt: COVER_NEG }
  }
  const style = (styleHint ?? '厚涂油画文艺').trim()
  const prompt = [
    `a ${style} literary book cover background`,
    '文艺书籍封面底图, 优雅抽象构图, 克制的低饱和色调, 中央留出空白标题区',
    'high-quality print texture, elegant, minimalist, 3:4 portrait, no text',
  ].join(', ')
  return { prompt, negativePrompt: COVER_NEG }
}
