# 书单号风格复刻与批量生成 设计文档

> 目标：让「拆解 → 生成」这条链真正**看着源视频来做**，把产出从「固定的水彩插画幻灯片 + 通用配音」升级为**对齐爆款书单号（如「听页/书评分享」）的风格：文案像、声音像、画面像、节奏像**。

**日期**：2026-07-17
**背景**：现有 v2.2 MVP 的拆解在 ASR 关闭时走 mock（空转写），框架是 LLM 凭空套的通用模板；生成层只产一种固定格式。真实测试中与源视频相似度 <1%。本设计补齐地基并做到风格对齐。

---

## 1. 目标产出规格（以「听页/书评分享」书单号为基准）

抽帧确认的源视频版式，每段画面自上而下：

- **《书名》+ 作者**（顶部常驻，如「《活下去的理由》马特·海格/著（书评）」）——同一本书的多段共享同一书名头
- **满屏配图**：厚涂油画 / 调色刀质感的艺术插画，情绪贴合该书；**同一本书的多张图风格统一成系列**（如反复出现「猫+窗」母题）
- **中英双语字幕**（下三分之一）：白色粗体中文 + 手写体英文译文，随口播逐句推进
- **@水印**（底部居中）
- **配音**：某固定音色（要克隆）
- **节奏**：每本书拆成多段、一段一句、约 2–3 秒/段

## 2. 用法矩阵（已与用户确认）

| 维度 | 选择 |
|---|---|
| 主用法 | **两者都要**：①提取爆款风格→批量生成【新书/新选题】；②重做同一条更像 |
| 书目来源 | **两者都支持**：①手填书单（书名+作者+要点）；②只给选题，LLM 自选书 |
| 画面忠实度 | 生成**同风格的新图**（不是复用源图），版式/画风/情绪对齐即可 |
| 声音 | 后台克隆音色，按框架选用；复刻流程可用源音频一键克隆 |

## 3. 现状与差距

| 维度 | 现状 | 目标 | 关键差 |
|---|---|---|---|
| 文案 | ASR 关闭→mock 空转写→LLM 套通用模板 | 真转写→按源文案+书目提炼 | **拆解没真跑** |
| 配音 | qwen-tts 通用 Cherry 音色 | CosyVoice 克隆源音色 | 无声音复刻 |
| 画面 | 写死「治愈系水彩插画」+ 开场标题卡 | 厚涂油画风 + 每段书名/作者常驻 + 书单号版式 | 画风与版式都不对 |
| 节奏 | TTS 时长驱动 + 固定缓推 | 对齐源分镜时长/字幕节奏 | 未用源节奏 |

## 4. 现有可复用的数据结构（无需新表的部分）

- `SourceVideo` → `Transcript{ fullText, sentences: Json }`：`sentences` 正好存**带时间戳的句子**（ASR + 节奏都用）
- `SceneCut{ cutPointsMs: Int[] }`：源分镜切点（节奏用）
- `CopyFramework`：已有 `visualStyleType / imageStylePrompt / overlayTemplate(Json) / renderTemplate / maxLines / maxTotalChars / frameworkText`
- `GenerationTask{ variables: Json, fullAudioUrl, bodyTimings: Json }`
- `GeneratedSegment{ seqNo, scriptText, imageUrl }`
- `AiCapabilityConfig{ capability, baseUrl, apiKeyEnc, model, enabled, extra: Json }`：新增能力（asr 已存在项、新增 vision、voice-clone 走 extra）

---

## 5. 外部能力（已核实，均在北京地域可用）

### 5.1 录音文件识别（ASR）
- Paraformer / Fun-ASR **异步**转写：`X-DashScope-Async: enable` 提交 → 得 `task_id` → 轮询取结果，**返回句级时间戳**，支持长音频。
- 备选 **qwen-asr**（多模态 `multimodal-generation`，同步，形态同现有 `dashPost`）——短音频优先用它更简单。
- **约束**：DashScope 需能**通过 URL 访问音频**。见 §6 URL 可达性。

### 5.2 CosyVoice 声音复刻
- 两步：`voice-enrollment` 建音色（`create_voice` + 目标模型如 `cosyvoice-v3.5-plus` + 前缀 + **样本音频 URL**）→ 得 `voice_id`；再用 CosyVoice 合成时传 `voice_id`。
- 北京地域可用；样本音频同样需 URL 可达。

### 5.3 视觉风格识别（新增 vision 能力，M2）
- `qwen-vl-max` / `qwen3-vl`（多模态）：对源视频抽样帧生成风格描述（"厚涂油画、暗调电影感、情绪化、书名压顶"），产出 `imageStylePrompt` 与版式判断。

> **实现前需二次核对**各接口的确切 `model` id、请求体字段与配额（写实现计划时逐一 WebFetch 官方文档并本地打通）。

---

## 6. 地基改造（M1 必做）

### F1. 资产 URL 可达性
ASR 与声音复刻都要 DashScope 能拉到音频。
- **线上**：已有公网域名 + `/api/files/*`。新增**短时签名 URL** helper：`publicAssetUrl(localRelPath, ttl)` → 返回带签名 token 的绝对 URL；`/api/files` 校验 token。
- **本地**：localhost 不可达 → ASR/声音复刻在本地走 **mock 或跳过**；真实验证放到服务器（或配置 OSS 上传）。文档明确写清。

### F2. 真 ASR 适配器
- 新增 `packages/db/src/ai/asr.ts` 的 DashScope 分支：
  - 优先 `qwen-asr`（同步 multimodal，复用 `dashPost`，传音频 URL）；
  - 长音频回退 Paraformer 异步（提交+轮询，封装 `dashAsyncSubmit/dashAsyncPoll`）。
- 产出 `{ fullText, sentences:[{text,startMs,endMs}] }` 写入 `Transcript`。
- `transcribe` job 改为真实调用；ASR 能力启用、模型名填有效值。

### F3. 拆解字数上限修复（真 bug）
- `extractFramework.ts` 现在 `maxTotalChars = min(600, max(120, textLen))` 与 `suggestedSegmentCount` 独立，导致「11 段 / 120 字」的死结。
- 改为**与段数一致**：`maxTotalChars = clamp(段数 × 每段期望字数[~18], 下限, 600)`，且 `maxLines ≥ 段数`。

---

## 7. 维度实现

### D1. 文案（M1）
- 拆解：真转写 → LLM 提炼「书单口播/书评公式」（钩子/金句/情绪节奏）+ 识别**书目**（若源含书名）。写入 `frameworkText` + 结构化 `overlayTemplate`（版式）+ 每书信息。
- 生成矩阵（两种入口）：
  - **手填书单**：`GenerationTask.variables.books = [{title, author, points}]` → LLM 按框架风格为每本书写**逐句书评文案**。
  - **选题自选**：`subject=主题` → LLM 先选 N 本书再写。
- 复用现有 `validateScript`（字数/行数），阈值按 F3 修正。

### D2. 配音（M1）
- 新表 `ClonedVoice{ id, voiceId(DashScope), name, sampleAssetUrl, provider, createdBy, createdAt }`。
- 新增 `packages/db/src/ai/voiceClone.ts`：`enrollVoice(sampleUrl,name)→voiceId`、`listVoices()`。
- `tts.ts`：当能力配置或框架指定 `voiceId` + CosyVoice 模型 → 用克隆音色合成（整篇仍分段以规避长度上限）。
- 后台 UI `/admin/models` 或新页 `/admin/voices`：运营上传/选取样本音频 → 克隆 → 命名；框架编辑页可选音色。
- 复刻流程：拆解抽取源音频 → 一键「用此声音克隆」。

### D3. 画面（M2）
- **拆解**：新增 vision 步骤，对源抽样帧 → 产出 `imageStylePrompt`（"厚涂油画、情绪化…"）、`visualStyleType`（如 `oil_painting`）、版式（书名位/字幕位/水印）写入 `overlayTemplate`。
- **数据**：`GeneratedSegment` 增 `bookTitle? / bookAuthor?`（或按 book 分组存于 task）。
- **模板**：新增/改造 `worker/templates/booklist`（或新 `shudan` 模板）为书单号版式：书名头常驻 + 满屏图 + 下三分双语字幕 + 水印。字体/位置对齐源。
- **图像一致性**：同一本书用统一 `imageStylePrompt` + 固定风格描述（必要时同 seed/母题）产系列图。

### D4. 节奏（M2）
- 从 `Transcript.sentences` 时间戳 + `SceneCut.cutPointsMs` 提取源节奏：平均段时长、段数、字幕节拍 → 写入框架（如 `pace`）。
- 生成：每段目标时长在 TTS 实际时长与源节奏之间对齐（`bodyTimings` 生成逻辑改造）。

---

## 8. 分期与验收

### M1「文案像 + 声音像」
1. F1 资产 URL 可达（线上签名 URL）
2. F2 真 ASR 适配器（拆解真转写，含时间戳）
3. F3 字数上限修复
4. D1 真文案提炼 + 生成矩阵（手填书单 / 选题自选）
5. D2 声音复刻（后台克隆 + 框架选音色 + 复刻一键克隆）

**验收**：上传一条书单源 → 拆解得**真实**转写与书目 → 生成新书单视频，**文案贴合源风格、配音为克隆音色**；服务器端跑通到 EXPORTED。

### M2「画面像 + 节奏像」
6. D3 视觉风格识别 + 书名/作者压字 + 书单号模板版式
7. D4 节奏对齐

**验收**：生成成片与源**同版式（书名头/双语字幕/水印）、同画风家族（厚涂油画）、段落节奏接近**；主观相似度显著高于当前。

---

## 9. 依赖与需用户提供

- 百炼控制台确认/开通：CosyVoice 声音复刻、录音文件识别（Paraformer/qwen-asr）、qwen-vl（M2）；提供各**有效模型名**。
- 线上公网域名可用（资产签名 URL 依赖它）；如需本地真实测试 ASR/克隆，需 OSS 或内网穿透。
- 一条**代表性源书单视频**（已有 be9f384c 可用）。

## 10. 风险与对策

- **本地不可真测 ASR/克隆**（localhost 不可达）→ 真实验证放服务器；本地保留 mock，遵循「本地 mock 打通逻辑 → 服务器真跑」的既有工作流。
- **克隆音质**：抖音音频常带 BGM → 必要时先做人声分离（`ffmpeg`/工具）再克隆；M1 先直接克隆看效果。
- **CosyVoice/qwen-tts 文本长度上限** → 整篇配音**分段合成再拼**（同时解决之前 qwen-tts 512 token 问题）。
- **接口形态未逐字核实** → 每个适配器实现前先 WebFetch 官方文档 + 本地/服务器最小打通，再接入流水线。
- **成本**：真 ASR + vision + 图像/TTS 批量 → 加每任务调用计数与失败重试上限（复用现有 job 结构）。

## 11. 不做（YAGNI）

- 不做口播真人/数字人（源是图文形态，不需要）。
- 不做逐帧/逐图像素级复刻（生成新图，仅风格对齐）。
- 不做多平台分发、A/B、数据回流（超出本设计）。
