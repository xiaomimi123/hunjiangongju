// 自带字体。**不依赖系统 fontconfig**。
//
// 起因：ASS 的 Fontname 走系统字体解析时，本机（macOS，无 Noto CJK）会退到 Helvetica，
// 中文逐字回退失败，画出来是豆腐块——而「墨迹断言」照样绿，验不出来。
// 也就是说，字幕对不对取决于运行环境装了什么字体，本地根本无法验证。
//
// 把字体文件放进仓库、渲染时用 fontsdir 指过去，本地与服务器就用同一个二进制字体，
// 字体解析变成确定性的，本地即可完整验收。
//
// 字体注册表见 @mixcut/db 的 BUILTIN_FONTS（worker/templates/booklist/fonts/README.md
// 有每款的许可与来源登记）。其中 Noto Sans SC 同时带 Regular 与 Bold 两个真实文件——
// 二者 family 相同（这是字体格式本身的设计，见 fonts.ts 类型注释），靠 (family, weight)
// 区分。这带来一个真实的坑：fontsdir 里如果同时放着这两个文件，ASS 样式行写死的
// Bold=1 会让 libass 选中真粗体，而不是像只有 Regular 时那样啥都不做/合成假粗体。
// 这正是 per-task fontsdir（只装本条片子选中的字体）存在的原因——见 ass.e2e.test.ts
// 「per-task fontsdir 挡住了 Bold 串号」一节的真渲染验证。

import path from 'path'
import { findBuiltinFont, DEFAULT_FONT_ID } from '@mixcut/db'

/** 字体目录（渲染时传给 subtitles 的 fontsdir） */
export const FONTS_DIR = path.resolve(__dirname, '../../../templates/booklist/fonts')

/** ASS 的 Fontname 用的是**字体内部族名**，不是文件名。实测该文件的 name(1) = 'Noto Sans SC'。 */
export const DEFAULT_FONT_NAME = 'Noto Sans SC'

/**
 * 本条片子真正要用到的内置字体 id 列表（去重，恒含默认字体）。
 *
 * 为什么必须恒含默认字体：正文字幕缺省就是它，且它是任何未配置/配置无效字段
 * 的回退落点——如果它不在结果里，per-task fontsdir 只装了别的字体时正文
 * 字幕会解析不到，退化成豆腐块。
 *
 * 为什么要过滤掉认不出的 id：TemplateParams 里的字体字段是运营在后台配的，
 * 不受类型系统保护；一个改过名/删过的 id 不该让整条渲染链炸掉，静默丢弃即可
 * ——反正丢了也有默认字体兜底。
 */
export function usedBuiltinFontIds(ids: (string | undefined)[]): string[] {
  const out = new Set<string>([DEFAULT_FONT_ID])
  for (const id of ids) {
    if (id && findBuiltinFont(id)) out.add(id)
  }
  return [...out]
}
