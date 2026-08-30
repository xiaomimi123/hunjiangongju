# 双语字幕 · 字体选择 · 画面编辑与预览 —— 设计

日期：2026-08-30
涉及页面：`/admin/frameworks/[id]/studio`（框架默认值）、`/admin/generate/[id]/studio`（单条调参）

---

## 背景与问题

三件事一起做，因为它们改的是同一条链路（文字层参数 → ASS → 成片）与同一套 UI（`web/components/admin/paramControls.tsx`）。

现状核查结论：

1. **双语字幕不是「样式不好看」，是数据在最后一公里被丢了。**
   `generateScript.ts` 的 `translateLine` 逐拍产出英文，`captionBeats[].en` 一路存到
   `worker/templates/booklist/bodyData.ts` 的 `BodySegment`，但在
   `worker/src/render/ffmpeg/fromBodyData.ts:91` 被 `map((b) => ({ zh: b.zh, startMs, endMs }))`
   丢弃。成片里从来没出现过英文。翻译的 LLM 调用一直在花钱，产物一直没被用。

2. **字体是死字段。** `packages/db/src/booklist/paramsWhitelist.ts` 的顶部注释明确记录
   `body.subtitleFontFamily`「草稿解析出来了但渲染器根本不读，字体恒为 `DEFAULT_FONT_NAME`」，
   接口层直接不收。仓库里只有 `NotoSansSC-Regular.otf` 一款，**没有粗体字面**——
   `ass.ts` 的 `TITLE_BOLD_BORD` 注释写明「libass 不为它合成假粗体，真加粗只能靠同色描边硬撑」。

3. **剪辑参数页是纯数字表单，没有任何视觉反馈。** 改完只能整条重新生成才看得到效果。
   而 `text.openTitlePosY / flashTitlePosY / bookTitlePosY` 三个参数**早就在白名单里放行了、
   界面上却从来没有控件**——运营根本调不到。

---

## 一、双语字幕

### 目标

框架级开关。开启时中文在上、英文紧贴其下；英文行可独立设字号倍数、颜色、行间距、字体。
关闭时完全不渲染英文（老框架逐字节零回归）。

### 参数（存 `TemplateParams.text`）

| 字段 | 类型 | 范围 | 默认 | 说明 |
|---|---|---|---|---|
| `bilingual` | boolean | — | `false` | 总开关。默认关 = 老框架零回归 |
| `enScale` | number | 0.3 ~ 1.0 | 0.6 | 英文字号 = `captionSizePx × enScale` |
| `enColor` | string | `#rrggbb` | `#dddddd` | 英文行颜色 |
| `enGapPx` | number | 0 ~ 40 | 8 | 中英两行的额外行间距 |
| `enFontId` | string | 字体注册表 id 或 `''` | `''` | `''` = 跟随正文字体 |

放 `text` 分区（不是 `body`）的理由：`text` 已经是「文字层字号/描边/颜色」的归属地，
`body` 里的 `subtitleColor/subtitlePosY` 是历史遗留的两个字段，不再往里加。
UI 上仍然展示在「字幕样式」卡片里，运营看到的是一处。

### 渲染实现

改动 4 个文件：

```
fromBodyData.ts:91   captionBeats 透传 en
renderBody.ts:19     RenderBodySegment.captionBeats 加 en?
ass.ts               AssCue 加 en?；AssStyleOpts 加上表 5 个字段
paramsWhitelist.ts   放行上表 5 个字段
```

**中英合并成一条 Dialogue 事件**，不拆成两条：

```
Dialogue: 1,0:00:03.20,0:00:05.60,cap,,0,0,0,,{\fad(120,120)}这是一句中文字幕\N{\fs29\c&HDDDDDD&\fn思源黑体}This is one line of English
```

一条事件时序天然一致，不需要在两层之间做对齐；`\fad` 也自动同时作用于中英两行。
英文段用内联覆盖标签改字号/颜色/字体，不新增 Style 行。

行间距 `enGapPx` 用 `\fsp` 不行（那是字距）。ASS 没有直接的行距标签，
实现方式是把英文行的 `\fs` 之前插一个高度为 `enGapPx` 的零宽占位——
**最终采用**：英文行前置 `{\fs<gapPx>}\h\N`（一个不换行空格 + 硬换行）撑出间距。
若实测该做法在 libass 下不稳，回退方案是把英文行拆成独立 Dialogue 事件 + `\pos` 精确定位
（时序仍从同一 beat 取，不存在对齐问题）。**此处必须由 e2e 墨迹断言验收，不能只靠代码审查。**

### ★ 必须处理的坑：中文行会被顶上去

正文字幕样式是 `an2`（底边锚点），`captionPosY` 定的是「字幕基线在画面高度的哪个位置」，
`buildAss` 里 `capMarginV = height × (1 - captionPosY)`。

加了英文行后整块文字变高，**在同一个 `subtitlePosY` 下中文行会被英文行顶上去**——
运营开关一次双语就会发现「字幕位置自己变了」，会当成 bug 报上来。

**解法**：开启双语时
`capMarginV = height × (1 - captionPosY) - (captionSizePx × enScale + enGapPx)`（下限 0）。
保证中文行位置与关闭双语时**逐像素一致**，英文行往画面下方生长。

这条要写一个专门的单元测试：同一份 `captionPosY`，开/关双语两次 `buildAss`，
断言中文行的实际基线位置相同。

### 顺带：关了双语就别再翻译

`translateLine` 现在是**无条件每拍调一次 LLM**（`generateScript.ts:720`）。
框架 `text.bilingual === false` 时跳过翻译，`en` 留空。
省掉一批调用，也让「关掉双语」这个动作有明确的成本含义。

注意 `subtitleEn`（整段英文=各拍拼接）也随之为空，需确认没有其它消费点依赖它非空
（已 grep：仅 `renderVisuals.ts:160` 条件透传，为空时不写，安全）。

---

## 二、字体选择

### 单一事实源

新文件 `packages/db/src/booklist/fonts.ts`，web 与 worker 共用：

```ts
export type FontEntry = { id: string; family: string; file: string; label: string }
export const BUILTIN_FONTS: FontEntry[] = [
  { id: 'noto-sc', family: 'Noto Sans SC', file: 'NotoSansSC-Regular.otf', label: '思源黑体 Regular' },
  // …实施前与用户确认最终清单
]
export const DEFAULT_FONT_ID = 'noto-sc'
```

`family` 是**字体内部族名**（`name` 表的 name ID 1），不是文件名——
ASS 的 `Fontname` 认族名，填文件名会静默回退到默认字体（`fonts.ts` 里已有这条踩坑记录）。

### 内置字体

放 `worker/templates/booklist/fonts/`（现有目录）。**清单实施前单独确认**，
每款 5~15MB 会进仓库，倾向只挑 3~4 款并优先考虑 subset。候选：

- 思源黑体 Bold（SIL OFL）—— 直接解决「书名不够粗只能靠同色描边硬撑」
- 思源宋体 Regular（SIL OFL）
- 霞鹜文楷（SIL OFL）
- 站酷快乐体（免费商用）

许可要求：只收 OFL / 明确免费商用且允许随产品分发的字体，README 里逐款登记许可。

### 上传字体

新表：

```prisma
model CustomFont {
  id        String   @id @default(cuid())
  label     String            // 运营填的显示名
  family    String            // 从文件 name 表解析出的内部族名
  fileName  String            // 落在 data/fonts/ 下的文件名
  createdAt DateTime @default(now())
}
```

- 上传接口 `POST /api/admin/fonts`，只收 `.ttf/.otf`，大小上限 30MB。
- 用 `fontkit` 解析 name 表取 `family`（不手写二进制解析器）。解析失败即拒收，
  因为族名错了会静默退回默认字体、成片看起来「字体没换」却毫无报错。
- 文件落 `data/fonts/`（与 `data/materials` 等同级，已在挂载卷内）。
- 版权由运营自负，上传页明写。

### 渲染时怎么喂给 ffmpeg

`ass.ts` 的 `subtitlesFilter` 只接受**一个** `fontsdir`，而一条片子可能同时用到
内置字体和自定义字体。

**做法**：渲染前建一个 per-task 字体目录（任务临时目录下），把本条真正用到的
1~3 个字体文件拷进去，`fontsdir` 指它。

- 干净：不污染仓库里的内置目录，也不需要把自定义字体写进仓库路径。
- 确定性：本地与服务器解析到的字体文件完全相同。
- 便宜：字体几 MB，一条片子拷 1~3 个文件，相对渲染耗时可忽略。

### 粒度：正文 / 标题 两档

| 参数 | 作用范围 |
|---|---|
| `text.captionFontId` | 正文字幕（cap 样式） |
| `text.enFontId` | 双语的英文行；`''` = 跟随正文 |
| `text.titleFontId` | 书名大标题（title）+ 快闪书名/作者（ft/fa）+ 开场标题（ot） |

不做四层各选：`ass.ts` 里正文与标题本来就是两套 Style，两档与现有结构对齐；
四个下拉框对运营是负担，真有需求再拆。

### web 预览取字体

新增 `GET /api/fonts/[id]/file`：
- 内置 id → 读 `worker/templates/booklist/fonts/<file>`
- 自定义 id → 查 `CustomFont` 读 `data/fonts/<fileName>`
- 带 `ETag` / `Cache-Control: immutable`（沿用 `/api/files/*` 已有的做法）

前端用 `FontFace` API 动态注册后再渲染画布。
**字体文件全仓库只存一份** —— `web/Dockerfile` 是 `COPY . .`，整个仓库都在 web 镜像里，
不需要往 `web/public/fonts/` 复制第二份。

---

## 三、画面编辑 + 画面预览

### 组件

新组件 `web/components/admin/StageCanvas.tsx`，两个工作台共用
（与 `paramControls.tsx` 同一个共用模式：同一个参数在两处必须长得一样）。

### 关键决策：DOM/CSS 绝对定位，不用 `<canvas>`

- 描边用 `paint-order: stroke` + `-webkit-text-stroke`，观感最接近 ASS 的 Outline
- CJK 换行与居中交给浏览器排版引擎 —— 自己在 canvas 里写换行算法必然与 libass 不一致
- 图层是真实 DOM 节点，拖拽、点选、焦点高亮都是原生能力

### 保真的三根支柱

1. **坐标 1:1，零换算。**
   外层 `transform: scale(containerW / videoW)`，内层一律用真实像素（720×1280）。
   画布上的每个数字**就是**存进参数的数字。换算是保真度问题的主要来源，直接消除。

2. **共享 `fitSizePx`。**
   `ass.ts` 里那个「长书名按可用宽度缩排」的纯函数（修过《被讨厌的勇气》被拖到 35px 那次）
   抽到 `packages/db`，前端直接 import。长书名在画布上的缩排行为与成片一致。
   抽取时保持函数体逐字节不变，`ass.ts` 改为 re-export，现有测试全部原样通过。

3. **同一份字体二进制。**
   预览通过 `/api/fonts/*` 拿到的就是 worker 渲染时 `fontsdir` 里的那个文件。

### 场景 tab

各文字层在时间上并不同时出现，一股脑全画反而失真。顶部给三个 tab：

| tab | 画出来的层 |
|---|---|
| 开场 | 开场标题（ot） |
| 快闪卡 | 快闪书名（ft）+ 作者（fa） |
| 正片 | 书名大标题（title）+ 正文字幕（cap，含英文行）+ 水印（wm） |

### 交互

- **点选图层** → 画布上高亮外框，右侧参数面板对应项高亮（双向定位）
- **纵向拖拽** → 改该层的 `PosY`（0~1，实时夹紧）
- **底部把手拖拽** → 改字号（正文改 `captionSizePx`，其余改各自的 `*Scale` 倍数）
- **水平方向不给拖** —— ASS 里所有文字层都是居中锚定（`an2` / `an5` + `\pos(cx, y)`），
  给水平自由度等于骗人，与 `TransitionRows` 只给「叠化/硬切」是同一条原则

### 顺带解锁三个死参数

`text.openTitlePosY / flashTitlePosY / bookTitlePosY` 已在
`paramsWhitelist.ts` 里放行，但 `TextRows` 里从来没有对应控件。
画布拖拽即是它们的第一个入口；同时在 `TextRows` 补三个数字输入框（拖拽与输入框双向绑定）。

### 底图

单选：`占位图`（默认）/ `亮底` / `暗底` / `上传`。

- 占位图：中性灰调，仓库内静态资源
- 亮底 / 暗底：纯色，用来快速判断「描边够不够、浅底图上字会不会糊」
- 上传：仅走 `URL.createObjectURL`，**不上传服务器、不入参数、不入库**

任务级工作台（`/admin/generate/[id]/studio`）默认拉本条任务的真实配图与真实字幕文本，
拉不到时回退占位图。

### 明说的取舍

画布是**模拟器不是渲染器**。字距、CJK 断行位置、描边叠加顺序仍会有细微差异。
画布角上常驻一行小字：「示意预览，最终以成片为准」。

**不做**「渲一段 3 秒真样片」——每次改参数都要等 ffmpeg 且占 worker，
与「边拖边看」的即时反馈相矛盾。等真有人反馈画布不够准再说。

---

## 测试策略

| 层 | 验收方式 |
|---|---|
| `buildAss` 双语输出 | 单测：断言事件行含 `\N{\fs…\c…}` 英文段；关闭时逐字节等于老输出 |
| 中文行不位移 | 单测：开/关双语两次 `buildAss`，断言中文基线位置相同 |
| 双语真渲染 | e2e 墨迹断言：中英两行都要有墨。**这一条不能省**——字体解析失败时画面是豆腐块，纯字符串断言照样绿 |
| 字体切换真生效 | e2e：解析 ffmpeg 的 `fontselect:` 日志，断言命中目标字体文件（沿用 `ass.e2e.test.ts:150` 已有做法） |
| 自定义字体族名解析 | 单测：喂一个已知族名的字体文件，断言解析结果 |
| `paramsWhitelist` | 单测：新字段越界夹紧、非法值丢弃 |
| `fitSizePx` 抽取 | 现有测试原样通过（函数体不变，只换文件） |
| `StageCanvas` | 组件测试：给定参数渲染出预期图层与位置；拖拽回调吐出正确数值 |

---

## 实施顺序

1. **双语字幕** —— 链路最短、价值最直接（翻译已经在花钱了，先让它出现在画面上）
2. **字体注册表 + 内置字体 + 渲染层接通** —— 画布要用同一份字体，必须在画布之前
3. **自定义字体上传**
4. **画布组件 + 两页接入**

每步独立可上线，不互相阻塞。
