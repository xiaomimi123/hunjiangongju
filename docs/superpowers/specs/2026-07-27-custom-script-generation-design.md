# 自定义文案生成（文案可控）设计

> 状态：设计定稿待评审 · 2026-07-27 · 分支 feat/shudan-m1

## 背景

现流程每条视频靠 LLM 全自动写文案，是质量最弱的一环——文案是视频的魂，AI 瞎写不稳定、不可控。
用户诉求：**文案由运营掌控**——直接给文案、或给参考让 AI 仿写。剪辑框架（flash/classic 模板）已做好、可复用；
每条视频只需前置搞定 **文案（人给）+ 配音 + 配图**。视频结构 = **书名标题 + 逐句配音字幕 + 配图**。

## 目标
- 生成入口新增「文案来源」三选一（与现有全自动并存、向后兼容）：
  - **manual 手动**：运营粘贴整段文案 → 系统按标点切分镜 → 跳过 LLM。
  - **imitate 仿写**：运营粘贴参考文案 → LLM 照其风格/主题仿写一版 → 再切分。
  - **auto 全自动**：现状（默认，不变）。
- 每条生成**单独填「书名标题」**，显示在视频里（开场/标题）。
- 分镜数量由文案切分决定（manual/imitate 不再用框架的 suggestedSegmentCount）。
- 配图/配音/对齐/渲染/BGM/音效/模板全部不变，直接复用。

## 非目标
- 逐张图手动指定/上传（后续迭代）。
- 真·书中原文引用的出处校验（LLM 仿写不保证原话）。
- 改动剪辑模板本身（flash/classic 已完成）。

## 硬约束
- **向后兼容**：`scriptMode` 缺省 = `auto`，走现有全自动路径，行为不变；现有测试全绿。
- **无数据库迁移**：新入参存 `generationTask.variables`（现有 Json 字段）：`scriptMode` / `customScript` / `bookTitle`。
- manual 模式**完全不调 LLM**（省钱、可控、快）。
- 切分为纯函数，可单测。

## 数据流

```
生成表单(文案来源 + 文案框 + 书名标题)
  → POST /api/generate: normalizeVariables 收 {scriptMode, customScript, bookTitle, …}
  → generationTask.variables
  → generate-script:
       auto     → 现状(LLM 按框架+选题写)
       manual   → splitScriptToSegments(customScript) 切分镜, 跳过 LLM        ← 新
       imitate  → LLM 按 customScript 仿写 → validate → 同 auto 切分          ← 新
     每分镜 → captionBeats(按逗号) + translateLine → 建 generated_segments
     书名标题: variables.bookTitle 贯到 overlay 显示                          ← 新
  → generate-image / tts / align / render(flash|classic)  ← 全不变
```

## 组件设计

### C1. 纯函数：文案切分镜 `splitScriptToSegments`（worker/src/gen 或 packages/db）
- 输入：整段文案字符串。
- 产出：`string[]` 分镜（每个 = 一句 scriptText）。
- 规则：按**句末标点** `。！？!?；;` 与**换行**切分镜；去空白、丢空段；单句过长不再二次切（句内节奏交给现有 `splitCaptionPhrases` 按逗号切 captionBeats）。
- 纯函数、单测（正常切分 / 多标点 / 换行 / 空输入 → []）。

### C2. normalize：接收新入参（web/app/api/generate/normalize.ts）
`normalizeVariables` 增：
- `scriptMode`：仅接受 `'auto'|'manual'|'imitate'`，其余/缺省 → `'auto'`。
- `customScript`：字符串，manual/imitate 必填且非空（清洗首尾空白）；否则报 400。
- `bookTitle`：字符串，可空（清洗）。
- 兼容：`books`/`voiceId` 现有逻辑不动。

### C3. generate API：放宽 subject（web/app/api/generate/route.ts）
现要求 `subject` 非空。manual 模式下选题无意义 → 允许：manual/imitate 时 `subject` 可空，服务端用 `bookTitle`（或 customScript 首句）兜底填充 `subject`（满足非空约束、且列表页有可读标题）。auto 模式仍要求 subject。

### C4. generateScript：按 scriptMode 分支（worker/src/gen/generateScript.ts）
- 读 `variables.scriptMode`（默认 auto）。
- **auto**：现状完全不动。
- **manual**：`clean = splitScriptToSegments(customScript)`；跳过 LLM / validate / 重试；直接进入"每分镜切 captionBeats + translateLine + 建 segments"的现有下游。
- **imitate**：用 `buildImitatePrompt(reference=customScript, subject/bookTitle)` 调 LLM → 复用现有 validate/budget 循环 → 切分。
- **书名标题**：`variables.bookTitle` 非空时，作为每段的 `bookTitle`（驱动《书名》头/开场标题）；与现有 `frameworkBooks`/手填 books 的优先级：**per-gen bookTitle 最高**。
- segCount：manual/imitate 由切分结果决定，不受 fw.suggestedSegmentCount 限制（maxTotalChars 仍可作安全上限兜底，超长仍 trim）。

### C5. imitate 提示词 `buildImitatePrompt`（纯函数）
- 指令：仿照【参考文案】的**语气、句式、情感浓度、第二人称口吻**，就同一主题**原创改写**一版新文案；不逐本介绍、不讲故事情节、不照抄参考；每句一行；不输出解释。
- 复用现有 `STYLE_RULES` + 字数/行数预算。
- 纯函数、单测（含参考文案、含无 CTA/无营销腔约束）。

### C6. 书名标题显示（渲染侧，最小改动）
- `renderVisuals.buildBodyData` / `buildOverlay`：`variables.bookTitle` 非空时优先作为 overlay 标题 / 段 bookTitle，使视频顶部/开场显示该书名。
- flash 模板：开场标题仍「今天分享的是」，书名作为标题卡/书名头显示（沿用现有 bookTitle→书名头逻辑）。

### C7. Web 生成表单（web/app/admin/generate 或对应页）
- 加「文案来源」单选：自动 / 手动粘贴 / 参考仿写。
- 手动/仿写时显示**文案输入框**（textarea）。
- 加**书名标题**输入框。
- 提交时组装 `variables.{scriptMode, customScript, bookTitle}`。
- 手动/仿写时选题框可选/隐藏。

## 测试策略
- 纯函数单测：`splitScriptToSegments`（切分规则/边界）、`buildImitatePrompt`（含约束词）、`normalizeVariables`（新字段校验/默认/非法）。
- generateScript：manual 分支不调 LLM（用 mock 断言未走 LLM 路径、段数=切分数）、imitate 分支走 LLM 仿写、auto 回归不变。
- 集成：本地对一段真实文案跑 manual → 分镜数正确、每段有 captionBeats、书名标题落到 overlay。

## 验收标准
- 手动模式：粘贴文案 → 出片文案**逐字就是你给的**（LLM 不改写）、按标点切分镜、书名标题显示、配图无人物、配音（真 TTS）+ 字幕逐句。
- 仿写模式：出片文案是参考风格的新文案。
- auto 模式与全部现有测试回归绿。
- 全自动/手动/仿写三入口在生成页可选。

## 风险
- 切分粒度：句子过多 → 图/配音调用多、慢（用户已知；可后续加"合并短句/上限"）。
- imitate 仍可能偏离风格 → 靠参考 few-shot + STYLE_RULES 收敛，必要时再调。
- 书名标题在 flash vs classic 两模板的显示位置需各自验收。

## 实测结论（2026-07-28，本地 manual 模式验证）
本地对用户「活下去的理由」那段文案跑 manual 模式，`generated_segments` 结果：
- 切成 **4 段分镜**（按句号切；句内逗号保留）。
- 每段 `script_text` **逐字等于用户文案**，无"模拟文案"——证实 **manual 完全跳过 LLM**。
- 每段 `book_title = 活下去的理由`——per-gen 书名生效。
（验证脚本因本地 redis 曾 OOM 退出，末步 enqueue 卡重连；段在 enqueue 前已建，逻辑不受影响，
生产 redis 正常。）manual 核心保证成立：文案你给什么、成片就是什么。

## 后续（本期不做）
- 逐张图手动指定/上传。
- 文案+配图的可视化逐条编辑（重生成单段已存在）。
- P2 学习器（上传剪映草稿→抽参数）仍另期。
