# 「书单快闪版」客户同款模板（P1）设计

> 状态：设计定稿待评审 · 2026-07-27 · 分支 feat/shudan-m1
> 本文是「学习并复刻客户剪映工程」的第一期（P1）。P2（上传剪映草稿→自动学参数）另立文档。

## 背景

客户提供了一条真实成片的**剪映草稿工程**（`今天分享的是/`，余华书单）。解析 `draft_content.json` 得到其"剪辑配方"，
本期把它固化成一套**参数化、可自动批量出片**的新模板 `booklist-flash`，与现有书单号模板并存。

### 从源工程解出的配方（720×960 / 24.6s）
| 环节 | 源工程做法 | 对应参数默认值 |
|---|---|---|
| 开场 0–2.16s | 首图 + 玻璃碎裂入场(破镜重圆 1.7s) +「今天分享的是」+ 齿轮音效 | `open.shatter=true, titleText, sfx=gear` |
| 书单快闪 2.16–3.98s | 9 本书封面各≈0.2s 极速闪过（逐本书名） | `flash.perClipMs≈200` |
| 过渡 | 水滴音效 + 叠化 | `audio.sfx.transitionDrop` |
| 正片 3.98–24.6s | 4 段长镜头(0.78/5.7/8.06/6.07s)，**仅叠化**(0.3–0.5s) | `transition=dissolve 300–500ms` |
| 书名字体 | 字由玄真 / 三极极宋超粗新（重花体/超粗宋） | `flash.titleFont`（客户提供字体文件） |
| 口播字幕 | 莫雪体·白色·下三分(y≈-0.49)·短句一行 | `body.subtitleFont/Color/PosY` |
| 长镜头运镜 | 基本无 Ken-Burns（克制） | `body.kenBurns="subtle"|"off"` |
| 音频 | BGM 0.69 垫底 + 口播满音量 + SFX(齿轮/水滴) | `audio.bgmVolume=0.69` |

源工程的音效/BGM 文件本地可用（齿轮 `7008….mp3`、水滴 `6974….mp3`），但可能是剪映授权素材：
**BGM 用我们自有内置曲库**；**SFX 先复用作占位、后续换等效免版权音**。

## 目标
- 新增 `booklist-flash` 模板：玻璃碎裂开场 → 书单快闪 → 叠化长镜头 → 莫雪体白字幕 → SFX+BGM 混音。
- **全参数化**：结构/节奏/转场/字幕样式/快闪/音效都是参数，默认值=上表配方，为 P2 预留填参接口。
- 书单快闪的书封用 **AI 生图（封面底图，无字）+ 叠书名文字层**。
- 保持全自动批量出片，且**与现有书单号模板并存、不破坏**。

## 非目标（P1 不做）
- P2 学习器（解析上传的剪映草稿→抽参数）。另期。
- 通用任意剪映工程复刻。
- 逐帧像素级一致（引擎/字体/配图差异决定不可能，目标是"像同一个号"）。
- 字体文件本身（客户提供 `.ttf/.otf`，本期只留参数槽 + @font-face 内嵌机制）。

## 硬约束
- 沿用现有引擎与契约：`hyperframes@0.7.33 render`、paused GSAP timeline、seek-safe（字面量值、无 function-based、无 Math.random）、self-contained HTML（本地 gsap/字体，无外网 CDN）、720×960。
- **不加数据库迁移**：参数存 `framework.overlayTemplate.__templateParams`（现有 JSON 字段）；书封图片走文件存储。
- **向后兼容**：结构模式唯一来源是 `__templateParams.mode`，缺省 = `classic`（现有模板，行为不变）；`= flash` 才走新结构。不引入其它选择字段。
- 不新增时长/不挪分段起止；正片段时长仍来自 TTS 段级真实时长（已实现）。

## 架构与数据流

```
framework(overlayTemplate.__templateParams{mode:flash,…}, .books)
  + subject
  → generate-script (正片文案, 已有)
  → generate-images:
       · 正片场景图 (每段一张, 已有)
       · 书封底图 bookCover (每本书一张, 新增用途)         ← 新
  → generate-tts (正片逐段真实时长, 已有)
  → align-captions (已有)
  → render-visuals:
       buildBodyData → BodyData{ …, template:'flash',
                                 templateParams, flashCovers[] }  ← 扩展
       renderIndexHtml 按 template 分支渲染 flash 结构           ← 新分支
       hyperframes render → body.mp4
  → render-video: 人声 + BGM(0.69) + SFX层(齿轮@开场/水滴@过渡)  ← SFX 新
  → qc (已有)
```

## 组件设计

### C1. 参数 schema（`overlayTemplate.__templateParams`）
P1 的核心契约。缺省则用下述默认（=源配方）。P2 将来产出同结构 JSON 填此处。
```jsonc
{
  "mode": "flash",                      // 结构模式；classic=现有
  "open":  { "shatter": true, "titleText": "今天分享的是", "sfx": "gear" },
  "flash": { "perClipMs": 200, "bounceIn": true, "titleFont": "flash-title" },
  "transition": { "type": "dissolve", "durationMs": 400 },
  "body":  { "subtitleFont": "subtitle", "subtitleColor": "#ffffff",
             "subtitlePosY": 0.78, "kenBurns": "subtle" },
  "audio": { "bgmVolume": 0.69,
             "sfx": { "openGear": true, "transitionDrop": true } }
}
```
`renderVisuals.buildBodyData` 读出 → `BodyData.template` + `BodyData.templateParams`。纯函数解析 + 默认值合并单独一个模块 `templateParams.ts`（可单测）。

### C2. 模板选择与结构分支（codegen）
`renderIndexHtml(data)`：`data.template==='flash'`（由 `templateParams.mode` 派生）→ 走 flash 编排；否则现有 classic（默认，不变）。
flash 编排 = 开场段 + 快闪段 + 正片段，拼进同一条 paused timeline。复用现有 `theme/motion/captionsAnim/layout`；新增 `flashMontage.ts`。

### C3. 书单快闪 montage（`flashMontage.ts`，新模块）
- 输入：`flashCovers: {title, author?, coverSrc}[]`（来自书单）、`perClipMs`、`titleFont`。
- 产出：每本一个 `.flash.fN`（封面底图 + 叠书名文字，标题字体）+ GSAP：在 `openEndMs + k*perClipMs` 处快速切入（可选 `bounceIn` 弹入），全部字面量、seek-safe。
- 时间：紧接开场之后，占 `N*perClipMs`；结束叠水滴音效 + 叠化进正片。
- 纯函数，单测：段数=书数、时间轴连续不越界、无 function-based 值。

### C4. AI 书封面生图（`bookCover` 用途 + 提示词）
- 新增生图用途：为 `overlayTemplate.books` 每本生成一张**封面底图**。
- 提示词（我来定稿，可按 `flash.coverStyle` 参数化，如 文艺/摄影/极简）：
  > "a minimalist literary **book cover background**, elegant abstract composition, muted tones,
  >  central empty space reserved for a title, no text, no letters, high-quality print texture, 3:4 portrait"
  > 负面词：`text, letters, words, watermark, title, characters, typography`（压掉任何文字）。
- 书名**不交给 AI**：用标题字体叠字层渲染（中文正确可控）。
- 存储：`data/gen/<id>/covers/NN.png`；`buildBodyData` 组装成 `flashCovers`。

### C5. 正片长镜头 + 莫雪体字幕（复用现有）
- 正片段 = 现有 body 逻辑：场景图 + caption beats 短句字幕。
- 样式改由 `templateParams.body` 驱动：字幕字体 `subtitleFont`、颜色、位置 `subtitlePosY`；`kenBurns=subtle|off`（源片克制）。
- 转场统一 `dissolve`（不走现有 5 种轮换）——flash 模式下 `motion.pickTrans` 固定叠化。

### C6. 音效层（`render-video` SFX 混音）
- 内置 SFX 资源（先复用源工程齿轮/水滴，后续换免版权）：`worker/assets/sfx/gear.mp3`、`drop.mp3`。
- `renderVideo` 的 ffmpeg 混音链新增 SFX 输入：齿轮 @ `[0, openEnd]`、水滴 @ 过渡点；音量参数化；与人声/BGM 一起 `amix` + loudnorm。
- `audio.sfx.openGear/transitionDrop=false` 时跳过。

### C7. 字体内嵌（@font-face）
- 模板目录放客户字体：`worker/templates/booklist-flash/fonts/{flash-title,subtitle}.*`（客户提供，本期占位或空）。
- codegen 用 `@font-face` 以相对路径引用（self-contained，同 gsap 本地化）；`templateParams` 里的 `titleFont/subtitleFont` 映射到 family 名。
- 字体缺失时回退系统字体（不崩），并在渲染日志 warn。

## 与源配方对齐（默认值即上表）
`templateParams` 缺省值 = 源工程解出的配方，因此**不配置**也直接产出"余华同款"结构。

## 测试策略
- 纯模块单测（沿用现有风格）：
  - `templateParams`：默认合并、mode 分支、非法输入回退。
  - `flashMontage`：段数=书数、时间轴连续/不越 data-duration、seek-safe、书名叠字转义。
  - `renderIndexHtml`(flash 分支)：契约属性、总时长=开场+快闪+正片、classic 默认不受影响（回归）。
  - 书封提示词构造：含负面压字词、无文字诉求。
- 集成/真渲染：本地对这条余华书单（books 已知）跑 flash 模板出片，抽帧**与源片逐帧对比**，迭代美术/节奏。

## 验收标准
- flash 模板出片：开场碎裂 + 书单快闪(逐本封面+书名) + 叠化长镜头 + 白字幕下三分 + SFX/BGM 混音，结构与源片一致。
- 逐帧对比源片，非专业眼"像同一个号"。
- classic 模板与既有全部测试不受影响（回归绿）。
- 全自动：现有生成入口选 flash 框架即出片，无新增人工步骤。

## 风险
- AI 书封美术需迭代几轮（提示词/风格）。
- 快闪 0.2s/本 ≈ 6 帧@30fps：需确认渲染清晰不糊、切换不丢帧。
- 字体授权（客户处理）；SFX 授权（后续换免版权）。
- 书目多时快闪过长/过短：`perClipMs` 或总时长上限需兜底。

## 实测结论（2026-07-27，本地真渲染）

对余华任务的真实分镜/时长 + 合成 6 本书单（占位封面=现有场景图）走 flash 模板真渲染
（720×960 / 37.6s，本机 chrome-headless-shell）抽帧验收，三段结构全部成立：
- **开场**：首图 + 强调 kicker +「今天分享的是」居中标题。
- **书单快闪**：逐本书封卡（封面 + 《书名》居中大字 + 作者朱砂色），在第 0 段窗口内快速切换。
- **正片**：叠化长镜头 + 白色双语字幕下三分（scrim 压暗底清晰）。

codegen 机制（参数→时间线→开场/快闪/正片编排→SFX 混音门控）验证通过。当前占位/待补（非机制问题）：
- 书封为场景图占位 → 待接**真 AI 书封生图**（提示词已在 `bookCoverPrompt.ts`，无字底图 + 叠书名）。
- 字体系统回退 → 待客户提供 `title.ttf/sub.otf` 放 `worker/templates/booklist/fonts/` 内嵌。
- SFX（齿轮/水滴）由单测 + 文件存在 + 模板开关三重门控；body.mp4 无音轨，混音在 render-video。

### 待微调（非阻断）
- `flashTimeline`：极端「多书 + 短开场段」时（`minClipMs*bookCount > 窗口`）末卡可能溢出第 0 段，
  可在时间线处 clamp 或提示（典型书单 5–15 本、开场段 3–5s 不触发）。

## P2 衔接（下一期预告）
P2 = 上传剪映草稿 → 解析 `draft_content.json` → 抽取 C1 的 `templateParams`（结构/节奏/转场/字幕/音频）→ 存入框架 → 直接驱动本模板复刻。P1 的参数 schema 就是 P2 的输出契约。
