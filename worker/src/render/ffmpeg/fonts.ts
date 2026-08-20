// 自带字体。**不依赖系统 fontconfig**。
//
// 起因：ASS 的 Fontname 走系统字体解析时，本机（macOS，无 Noto CJK）会退到 Helvetica，
// 中文逐字回退失败，画出来是豆腐块——而「墨迹断言」照样绿，验不出来。
// 也就是说，字幕对不对取决于运行环境装了什么字体，本地根本无法验证。
//
// 把字体文件放进仓库、渲染时用 fontsdir 指过去，本地与服务器就用同一个二进制字体，
// 字体解析变成确定性的，本地即可完整验收。
//
// 字体：Noto Sans SC Regular（SIL Open Font License 1.1，允许随产品分发）。
// **只带 Regular**：粗体由 libass 合成（大字号下观感可接受）。再带一个 Bold 面
// 会让仓库多 8MB，等真有人反馈标题不够粗再说。

import path from 'path'

/** 字体目录（渲染时传给 subtitles 的 fontsdir） */
export const FONTS_DIR = path.resolve(__dirname, '../../../templates/booklist/fonts')

/** ASS 的 Fontname 用的是**字体内部族名**，不是文件名。实测该文件的 name(1) = 'Noto Sans SC'。 */
export const DEFAULT_FONT_NAME = 'Noto Sans SC'
