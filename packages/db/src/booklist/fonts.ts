// 字体注册表：web 与 worker 的**单一事实源**。
//
// worker 需要 file（拷进 fontsdir）与 family（写进 ASS 的 Fontname）；
// web 需要 family（画布上的 CSS font-family）与 id（下发文件的路由参数）。
// 两边各维护一份必然会漂，所以放在 packages/db 里共用。
//
// ★ family 必须是**字体内部族名**（name 表的 name ID 1），不是文件名。
// ASS 的 Fontname 认族名；填文件名会静默回退到默认字体、没有任何报错
// （见 worker/src/render/ffmpeg/fonts.ts 里已有的踩坑记录）。
// 加新字体时用 `fc-scan --format "%{family}\n" <file>` 或 fontkit 确认族名，不要凭文件名猜。

export type FontEntry = {
  /** 稳定标识，存进 TemplateParams。改了它等于把已配置的框架的字体设置清空 */
  id: string
  /** 字体内部族名，写进 ASS 的 Fontname / CSS 的 font-family */
  family: string
  /**
   * 字重。ASS 靠 Fontname + Bold 位共同定位一个字面——同一字体族的 Regular 与
   * Bold 两个文件的 family 本来就相同（只有 name 表的 subfamily 不同），
   * 这不是撞名，是字体格式本身的设计。ass.ts 拼 Style 行时用它推导 Bold 位。
   */
  weight: 400 | 700
  /** worker/templates/booklist/fonts/ 下的文件名 */
  file: string
  /** 后台下拉里的中文显示名 */
  label: string
}

export const BUILTIN_FONTS: readonly FontEntry[] = [
  { id: 'noto-sc', family: 'Noto Sans SC', weight: 400, file: 'NotoSansSC-Regular.otf', label: '思源黑体 Regular' },
] as const

/** 一个字体都没配时用它。与 worker 的 DEFAULT_FONT_NAME 指同一款。 */
export const DEFAULT_FONT_ID = 'noto-sc'

export function findBuiltinFont(id: string | undefined): FontEntry | undefined {
  if (!id) return undefined
  return BUILTIN_FONTS.find((f) => f.id === id)
}
