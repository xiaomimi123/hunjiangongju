// 书单快闪的书封「底图」提示词：只出封面质感画面、居中留白给标题区、绝不含任何文字。
// 书名由标题字体叠字层渲染(见 flashMontage)，因此这里刻意不把书名放进正向提示。

export interface CoverPrompt { prompt: string; negativePrompt: string }

// 默认外壳用的负向词：禁文字（功能性）+ 禁人物（默认抽象封面产出风景/静物最稳）
const COVER_NEG =
  '人, 人物, 人脸, 人像, person, people, human, face, portrait, ' +
  '文字, 字, 汉字, 字母, 单词, 书法, 标题, 作者名, 字幕, 水印, 条形码, ' +
  'text, letters, words, title, author, typography, caption, watermark, barcode, signature'

// 自定义提示词用的负向词：**只禁文字**。
// 禁人物是给默认抽象外壳配的保险，不是功能性约束——运营写「文学名著的封面」
// 这类画面很可能就要人物，带着人物禁令等于把他的提示词砍掉一半
//（线上实测：同一段提示词直接调模型效果好、走后台差很多，这就是差异源之一）。
const COVER_NEG_TEXT_ONLY =
  '文字, 字, 汉字, 字母, 单词, 书法, 标题, 作者名, 字幕, 水印, 条形码, ' +
  'text, letters, words, title, author, typography, caption, watermark, barcode, signature'

/**
 * @param styleHint 画风词，套进固定的「文艺封面底图」外壳（历史行为）
 * @param customPrompt 框架单独配置的**完整画面描述**（overlayTemplate.__coverPrompt）。
 *   留白、构图这些由运营自己写（用户拍板：管理员通过提示词自己做限制）。
 *   只保留负向词的禁文字兜底：它不与任何画面描述冲突，而书名标题要叠在封面上，
 *   底图带字必然糊成一团。
 *
 *   **书籍信息注入**（用户要求书封要对得上这本书）：
 *   - 提示词里写了 {{书名}} / {{作者}} 占位符 → 逐本替换，位置由运营控制；
 *   - 没写占位符 → 自动在结尾补「以《书名》（作者）的主题与意象为灵感」。
 *   把书名放进提示词有让模型把字画进图里的风险（原设计因此不放），
 *   靠负向词的禁文字压制；运营自己的提示词里再加一道禁文字更稳。
 */
export function buildBookCoverPrompt(
  book: { title: string; author?: string },
  styleHint?: string,
  customPrompt?: string,
): CoverPrompt {
  const custom = (customPrompt ?? '').trim()
  if (custom) {
    const author = (book.author ?? '').trim()
    let prompt: string
    if (/\{\{\s*(书名|title)\s*\}\}|\{\{\s*(作者|author)\s*\}\}/.test(custom)) {
      prompt = custom
        .replace(/\{\{\s*(书名|title)\s*\}\}/g, `《${book.title}》`)
        .replace(/\{\{\s*(作者|author)\s*\}\}/g, author)
    } else {
      prompt = `${custom}。以《${book.title}》${author ? `（${author}）` : ''}的主题与意象为灵感`
    }
    return { prompt, negativePrompt: COVER_NEG_TEXT_ONLY }
  }
  const style = (styleHint ?? '厚涂油画文艺').trim()
  const prompt = [
    `a ${style} literary book cover background`,
    '文艺书籍封面底图, 优雅抽象构图, 克制的低饱和色调, 中央留出空白标题区',
    'high-quality print texture, elegant, minimalist, 3:4 portrait, no text',
  ].join(', ')
  return { prompt, negativePrompt: COVER_NEG }
}
