// 从 ttf/otf 里读出运营上传的自定义字体的两个关键属性：**族名**与**字重**。
// 两者都是"上传即解析、不让运营手填"的字段——手填必错、错了还不报错。
//
// 族名（name 表 name ID 1）：ASS 的 Fontname 认族名不认文件名，填错的后果是
// 成片**静默回退到默认字体**——渲染日志毫无异常，排查成本极高。见 fonts.ts 头部
// 已有的踩坑记录。所以解析不出族名（空、纯空白、或 .ttc 字体集合没有 familyName）
// 一律拒收，不接受"先收下、以后再说"。
//
// 字重：libass 靠 Fontname + 样式行的 Bold 位一起定位字面。ass.ts 的 cap/wm 样式
// 行里 Bold 位由字体条目的 weight 推出（见 fonts.ts 的 FontEntry.weight 注释）。
// 内置字体表手工标注了 weight，但自定义字体如果不存这个字段，运营上传一个粗体
// 字体、选它当正文字幕，会毫无反应——libass 拿到 Bold=0 就去挑常规字面，
// 界面上设了、成片没变化、日志也不报错，是同一类静默失效。
//
// 字重优先读 OS/2 表的 usWeightClass（>=600 记 700，否则 400，这是 OpenType 规范
// 的粗细分级：400=Regular，700=Bold，600 是常见的 SemiBold/Bold 分界线，落在中间的
// 字体基本都是加粗过的），OS/2 表缺失（部分手工字体、部分老式 ttf 会没有）则退而看
// subfamily 名（如 "Bold"/"Bold Italic"）里是否含 "bold"（不分大小写），两者都拿
// 不到才落回 400——不确定时按"没加粗"处理比误判成"加粗"更安全（后者会让常规字面
// 意外变粗）。

// fontkit 的 ESM 构建（node 的 import 条件走 dist/module.mjs）没有 default export，
// 只有具名导出；`import fontkit from 'fontkit'` 在 vitest/vite 环境下拿到的是
// undefined（CJS 那份 dist/main.cjs 才有 module.exports 可供合成 default）。
// 所以这里用具名导入，两种构建都吃得下。
import { openSync } from 'fontkit'

export type ParsedFontMeta = { family: string; weight: 400 | 700 }

export function readFontMeta(fileAbs: string): ParsedFontMeta {
  const font = openSync(fileAbs)

  // 字体集合（.ttc）返回 FontCollection，没有 familyName/OS2/subfamilyName；
  // 本项目不收集合文件，直接拒收。
  const family = (font as { familyName?: string }).familyName
  if (!family || !family.trim()) {
    throw new Error('无法解析字体族名（可能不是有效的 ttf/otf，或是字体集合文件）')
  }

  const weightClass = (font as { ['OS/2']?: { usWeightClass?: number } })['OS/2']?.usWeightClass
  const subfamily = (font as { subfamilyName?: string }).subfamilyName
  const weight: 400 | 700 =
    typeof weightClass === 'number'
      ? (weightClass >= 600 ? 700 : 400)
      : (subfamily && /bold/i.test(subfamily) ? 700 : 400)

  return { family: family.trim(), weight }
}
