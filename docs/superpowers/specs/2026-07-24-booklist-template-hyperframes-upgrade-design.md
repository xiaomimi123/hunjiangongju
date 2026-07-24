# 书单号模板升级：运镜 + 美术（HyperFrames codegen 重写）

> 状态：设计定稿待评审 · 2026-07-24 · 分支 `feat/shudan-m1`

## 背景

书单号生成走的是全自动流水线：运营填表 → LLM 文案 → 文生图 → 逐段 TTS（真实时长对齐）→
**程序自动拼出一份 HyperFrames `index.html`** → `hyperframes render` 出无声视频 → render-video 混音。

产出视频"能看但木"。两个具体痛点（用户确认）：

1. **运镜太木**：`worker/templates/booklist/indexHtml.ts` 里每个场景都用同一招——缓推近
   (scale 1.035→1.105) + 同一种 crossfade + 同一种碎片转场。全片一个节奏。
2. **美术糙**：字号、配色散落硬编，构图简单，不像"有设计感的爆款书单号"。

关键认知：**渲染引擎（HyperFrames）本来就在用**，问题出在"手写的单一模板"本身，不在引擎。
因此本次不换引擎、不升版本、不动流水线，只把"自动拼 HTML"这一步的产出做深。

## 目标

- 运镜从"单一一招"升级为"多招式 + 多转场，按段确定性轮换、与字幕节拍同步"。
- 美术落一套设计 token + 更像爆款号的构图，并提供 **3 套风格预设**自动轮换。
- 全程**保持全自动**：运营侧交互零变化，不新增人工。
- 把 415 行的巨型 codegen 拆成职责单一、可单测的小模块。

## 非目标

- 不换渲染后端（继续 `hyperframes@0.7.33 render`）。
- 不升级 hyperframes 版本（版本升级的收益与风险单列，见"后续可选"，本期不做）。
- 不改上游（script/image/tts/align）与下游（render-video 混音）。
- 不改输入契约 `BodyData`，故 `renderVisuals.ts:buildBodyData` 基本不动。

## 硬约束（贯穿全程）

1. **Seek-safe / 确定性渲染**：HyperFrames 无头渲染靠"seek 一条 `paused` 的 GSAP timeline"。
   所有 tween **必须用字面量值**，禁止 function-based from/to（当前模板已踩坑并注释，新代码继续遵守）。
   涉及"逐字/分片"的效果，其初始态必须**烘焙进内联样式**，GSAP 只做 `to` 归位。
2. **不新增时长、不挪动分段起止**：所有特效叠在既有 `startMs/endMs` 时间窗之上；
   timeline 总长严格等于 `max(endMs)`，任何 tween 不得越过 `data-duration`。
3. **无随机**：招式/转场/预设的分配一律由 `seqNo` / `genTaskId` 派生，纯函数、可复现
   （同任务重跑产出逐字节一致，便于测试与幂等）。
4. **契约不变**：产出仍是 `<main data-composition-id="main" data-start data-duration data-width data-height>`
   + 常驻层 + `window.__timelines["main"]` 挂 paused timeline，本地引用 `gsap.min.js`。

## 架构：模块拆分

现状 `indexHtml.ts` 一个文件干所有事（HTML 结构 + CSS + 碎片网格 + 全部 GSAP + 书名头 + 字幕）。
拆成各司其职的纯模块，`indexHtml.ts` 退化为编排器：

| 模块 | 职责 | 依赖 |
|---|---|---|
| `theme.ts` | 设计 token 与 3 套预设 → CSS 变量块；预设选择逻辑 | 无 |
| `motion.ts` | 运镜库 + 转场库：给定招式名 + 场景参数，返回 GSAP tween 字符串 | 无 |
| `captionsAnim.ts` | 字幕节拍入场动画：给定拍 + 入场型，返回 tween 字符串 | 无 |
| `layout.ts` | HTML 结构片段：场景/图片/字幕/书名头/标题卡/水印/装饰层 | `theme` 的类名约定 |
| `indexHtml.ts` | 编排：拉齐 segments、分配招式、组合上述模块、拼出完整 HTML | 全部 |

数据流不变：`renderVisuals.buildBodyData(task, segments) → BodyData → renderIndexHtml(data) → index.html`。

每个模块的对外接口用"给定数据 → 返回字符串片段"的纯函数，输入输出可直接断言，便于单测
（沿用现有 `worker/templates/booklist/indexHtml.test.ts` 的 18 测试风格）。

## 运镜升级（motion.ts）

### 运镜库（场景内，跨整段时间窗）

每个场景从下列招式中按 `moveIndex = (seqNo + presetOffset) % MOVES.length` 选一招；
`MOVES` 顺序编排使相邻段不撞招。全部为字面量 tween、`ease` 用 `sine.inOut`/`power2.out` 类：

1. `push-in` 缓推近（Ken-Burns，现有）
2. `pull-back` 缓拉远
3. `pan-right` 横摇（背景略宽，x 负→正）
4. `pan-left` 横摇（x 正→负）
5. `drift-up` 缓上移（y 正→负）
6. `tilt-settle` 轻微旋入归正（rotation 小角 → 0 + 微推）

（`.photo` 已用 `inset:-22px` 留出溢出边，横摇/上移不会露底；必要时按招式加大对应方向的 inset。）

### 转场库（场景边界，落在既有 0.72s crossfade 窗内，不占额外时长）

按 `transIndex = (seqNo + presetOffset) % TRANS.length` 轮换：

1. `crossfade` 叠化（现有）
2. `wipe` 擦除（clip-path inset 由 100%→0，字面量关键帧）
3. `shard` 碎片（现有网格，保留）
4. `glide-push` 滑推（上一场景 translate 出，新场景 translate 入）
5. `blur-dissolve` 模糊溶解（上一场景 filter blur↑ + opacity↓）

首场景保留"玻璃碎片开场"（现有效果，效果好、已验证 seek-safe）。

### 与字幕节拍同步

TTS 修复后每段带精确 `captionBeats[].startMs/endMs`。在**每个场景首拍的 startMs**处，
给该场景运镜叠一个极短的"重拍"强调（如 0.12s 的 scale 微脉冲），使运镜与口播起拍咬合，
制造节奏感。无节拍的旧任务自动跳过（回退纯场景运镜）。

## 字幕节拍入场（captionsAnim.ts）

现状：每拍统一 `fade + y`。升级为按 `capIndex % ENTRANCES.length` 轮换的入场型
（全部 seek-safe，初始态烘焙内联）：

1. `fade-up` 淡入上移（现有）
2. `mask-reveal` 遮罩揭开（clip-path，从一侧擦出）
3. `char-stagger` 逐字浮现（codegen 把每字拆成 `<span>`，初始 opacity/y 烘焙内联，GSAP `to` + stagger 归位）
4. `slide-in` 侧滑入

> `char-stagger` 的 seek-safe 性是本设计的最大技术不确定点，**落地时最先做一条真渲染验证**；
> 若无头 seek 下 stagger 表现异常，降级为 `mask-reveal`。

## 美术升级（theme.ts）

### 设计 token（→ CSS 变量，注入 `:root`）

- 配色：`--bg` `--ink` `--ink-dim` `--accent` `--scrim`
- 字号阶梯：`--fs-title` `--fs-book` `--fs-cap-zh` `--fs-cap-en`
- 版式：`--safe-x` `--cap-bottom` 等安全区/间距
- 字族：标题/书名 serif，正文 sans，英文手写体（现有）参数化

### 构图元素（layout.ts + theme.ts 协同）

- **字幕压暗底**：字幕区下方渐变 scrim，保证任意底图上字幕清晰（治"看不清"）。
- **背景模糊填充**：非等比图不再拉伸/露底，用同图放大模糊铺底 + 原图居中（letterbox 消除）。
- **书名头 kicker**：书名头加一条强调色短杠 + 更讲究的排版。
- **颗粒 / 暗角**：可选叠加层，按预设开关，增质感（暗角现有，保留）。
- 标题卡 / 水印：统一到 token，随预设变化。

### 3 套风格预设

token 组，整套切换。初版三套（可后续增删）：

1. `warm-literary` 暖色文艺：奶油底 + 烫金强调 + 宋体标题（≈现有风格的精修版）。
2. `dark-premium` 暗黑高级：深炭底 + 高对比白 + 细金线，克制高级。
3. `ink-oriental` 国风墨韵：宣纸质感 + 墨黑 + 朱砂强调 + 衬线，贴合书单调性。

### 预设选择逻辑

优先级：`framework.overlayTemplate.__style`（框架可指定）→ 否则由 `genTaskId` 派生的
稳定索引 `% 3`（同任务重跑不换预设）。`presetOffset` 亦由此派生，使不同预设的招式轮换错开。

## 测试策略

**单元测试**（每模块，纯函数）：
- `theme`：预设选择确定性；指定 `__style` 命中；未指定时 `genTaskId` 派生稳定。
- `motion`：招式/转场分配确定且相邻不撞；产出 tween 位置 ∈ `[startMs, endMs]`；无 function-based 值
  （断言产出字符串不含 `function`/箭头形态的动态值）。
- `captionsAnim`：每拍入场 tween 起点 == 拍 startMs；`char-stagger` 拆字数 == 字符数且初始态内联。
- `indexHtml`（扩充现有 18 测试）：timeline 总长 == `max(endMs)`；无 tween 越过 `data-duration`；
  段数/图片数/字幕单元数一致；HTML 结构含契约必需属性。

**集成/真渲染验收**：本地对样例任务真跑 `hyperframes render` 出片，抽关键帧截图人工验收美术，
逐预设各出一条。美术是主观项，早出样片、迭代数轮（用户已选：**本地渲染截图给用户看**）。

## 验收标准

- 三套预设各出一条样片，截图评审通过（运镜有变化、转场不单调、字幕清晰、美术"像爆款号"）。
- 全部单测绿；本地真渲染无报错、尺寸 720×960、总时长 == 音频时长。
- 全自动流程不变：现有生成入口跑通，无新增人工步骤。
- 旧任务（无 `captionBeats` 精确时间）仍能回退渲染，不崩。

## 风险与缓解

| 风险 | 缓解 |
|---|---|
| 美术审美主观，可能返工 | 早出本地样片、按截图迭代；先 1 套跑通再复制到 3 套 |
| `char-stagger` 在无头 seek 下可能失效 | 落地即刻真渲染验证；失效则降级 `mask-reveal` |
| 新转场（wipe/blur）在 0.7.33 + Chromium 下渲染差异 | 每种转场单独出一条最小样片验证后再纳入轮换 |
| 3 套预设工作量成倍 | 抽公共构图，预设只覆盖 token；美术调校排在最后、可分批 |

## 后续可选（本期不做）

- 升级 hyperframes 版本，接入新版蓝图库 / registry 组件块（原路线 C 的另一半）。
- 更多预设 / 按选题品类自动匹配风格。
