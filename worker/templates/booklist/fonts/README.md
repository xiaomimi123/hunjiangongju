# 书单快闪版字体

内置字体放这里（self-contained，渲染时通过 fontsdir 指过来，不依赖系统 fontconfig）。
注册表见 `packages/db/src/booklist/fonts.ts` 的 `BUILTIN_FONTS`（web 与 worker 的单一事实源）。

缺失或 id 认不出时渲染自动回退默认字体（`noto-sc`），不报错。

## 许可登记

| 字体名 | 文件名 | 内部族名 | 字重 | 许可 | 来源 |
|---|---|---|---|---|---|
| 思源黑体 Regular | `NotoSansSC-Regular.otf` | `Noto Sans SC` | 400 | SIL Open Font License 1.1 | https://github.com/notofonts/noto-cjk (`Sans/SubsetOTF/SC/`) |
| 思源黑体 Bold | `NotoSansSC-Bold.otf` | `Noto Sans SC` | 700 | SIL Open Font License 1.1 | https://github.com/notofonts/noto-cjk (`Sans/SubsetOTF/SC/`) |
| 思源宋体 | `NotoSerifSC-Regular.otf` | `Noto Serif SC` | 400 | SIL Open Font License 1.1 | https://github.com/notofonts/noto-cjk (`Serif/SubsetOTF/SC/`) |
| 霞鹜文楷 | `LXGWWenKai-Regular.ttf` | `LXGW WenKai` | 400 | SIL Open Font License 1.1 | https://github.com/lxgw/LxgwWenKai/releases/download/v1.520/ |
| 站酷快乐体 | `ZCOOLKuaiLe-Regular.ttf` | `ZCOOL KuaiLe` | 400 | SIL Open Font License | https://github.com/google/fonts/tree/main/ofl/zcoolkuaile |

**站酷快乐体只有 7055 个字形**（展示体，覆盖约常用字范围），生僻书名/作者名可能出现豆腐块。
用它之前建议先预览。其余 4 款均 3 万字形以上。

族名（内部族名，即 name 表 name ID 1）用 fontkit / `fc-scan --format "%{family}\n"` 实测得到，
不是凭文件名猜的——ASS 的 Fontname 认族名，填错会静默回退默认字体、没有任何报错。

加新字体时同步更新这张表和 `BUILTIN_FONTS`，并跑一遍
`packages/db/src/booklist/fonts.test.ts`（会逐字比对磁盘文件的真实 familyName 与注册表）。
