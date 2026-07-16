# 爆款视频拆解生成智能体 v2.2 —— 设计 Spec

> 本 spec 把《爆款视频拆解生成智能体_MVP开发文档_v2.2》适配到当前代码库（原「东方文澜/投流素材混剪工具」）。
> **这是一次换产品**：核心从「实拍素材混剪」整体替换为「拆解爆款视频 → AI 生成同结构新视频」。新产品**取代**现有东方文澜。
> 与 ForgeCast 无关（ForgeCast 是另一个独立产品）。

**日期**：2026-07-16
**基线仓库**：`hunjiangongju`（同仓库演进，保留基建）
**范围**：v2.2 文档定义的完整 MVP 闭环（完全体），仅书单号一个垂类、`ai_illustration` 一种画面策略。v2.2 §10 路线图 Phase 2–4（跨行业、LoRA、学员计费）**不在本期**。

---

## 1. 目标与成功标准

跑通两条流水线的完整闭环：

- **拆解**：运营粘贴抖音分享链接（或手动上传视频兜底）→ 下载 → ASR 转写 → 场景检测 → LLM 提炼可复用文案框架 → 存入框架库。
- **生成**：运营选框架 + 填新主题（subject，如书名）→ LLM 生成新文案（自动长度校验）→ 逐段文生图 → 整篇 TTS → silencedetect 对齐 → HyperFrames 渲染视觉 → FFmpeg 合成 → 质检 → 发布到学员端。

**成功标准**：从一个手工建的框架出发，能产出一条真实的、可下载的 AI 生成竖屏视频（图片轮播 + 标题卡片 + 水印 + 字幕 + 配音 + BGM），并通过黑屏/静音/字幕越界质检；随后拆解流水线能从一条真实抖音视频自动产出一个框架供生成使用。

---

## 2. 关键决策（已确认）

| 议题 | 决策 |
|---|---|
| 产品关系 | 换产品；新产品取代现有东方文澜；同仓库演进 |
| ForgeCast | 独立产品，无关，不复用 |
| AI relay（aitoken.homes） | **各能力独立端点 + 已有 key**；每种能力单独配置端点/密钥/模型 |
| 模型配置 | 后台新增 `/admin/models` 页，仿 SMTP 页：per-capability 端点+密钥+模型+启用开关+测试按钮 |
| 抖音入口 | 自研解析分享链为主 + **手动上传视频兜底** |
| 存储 | 先本地 `/data`（沿用 `/api/files`）；OSS/COS 作可插拔层预留 |
| 学员端 | 只浏览 + 下载成片，本期不做学员编辑 |
| ASR 选型 | 走 relay（不自建 whisper.cpp） |
| 范围 | 完全体 MVP 闭环（P0–P3 全做）；跨行业等为架构预留 |

---

## 3. 复用 / 删除 / 新建 清单

### 3.1 保留（原样或轻改复用）
- 脚手架：Next.js 14 + TS + Tailwind、Prisma + PostgreSQL、Redis + BullMQ、Docker Compose。
- 账号鉴权：`User`(operator/student)、`@/lib/auth`(requireRole/HttpError/getSession)、`@/lib/session`/`@/lib/jwt`、`@/lib/api`(handler)、`@/lib/ratelimit`、`@/lib/crypto`(AES-256-GCM，用于加密 API key)。
- 邮箱注册/登录/找回/改密整套（`/api/auth/*`）、`/admin/account`、`/admin/settings`(SMTP)。
- 部署基建：`docker-compose.prod.yml` + Caddy 自动 HTTPS + 国内构建镜像源 + `deploy/`；后台壳（`AdminLayout`/`SidebarNav`/`PageHeader`/`StatCard`/`Modal`）、`/admin` 仪表盘（指标改数据源）。
- 质检模块：`worker/src/jobs/runQc.ts` + `detectBlack`/`detectSilence`/`checkSubtitleOverflow`；`task_status_logs`/`qc_reports` 设计模式（FK 改指 `render_tasks`）。
- 学员端「我的作品」壳：`(student)/works`、`(student)/works/[id]`、`StatusPill`/`PipelineRail`（状态集换成新流水线）。
- 文件服务：`/api/files/[...path]`（range 支持）、`DATA_DIR`。

### 3.2 删除（v1.0 混剪专属）
- 表：`materials`、`material_tags`、`tag_categories`、`segment_tags`、`tasks`、`task_segments`。
- 接口：`/api/materials*`、`/api/tag-categories*`、`/api/scripts*`、`/api/tasks*`（旧混剪语义）。
- 页面：`/admin/materials`、`/admin/tags`、`/admin/scripts`（旧混剪文案）、学员端「模版」页旧语义、`/admin/tasks` 旧语义（重建为渲染任务）。
- Worker：`matchMaterials`、`segmentScript`、旧 `renderDraft`（实拍拼接）。
- `Script`/`ScriptSegment`/`Material` 相关 Prisma 模型。

> **不在线上跑着的库上做破坏性 DROP。** 新产品用新 schema；切换时按第 12 节策略处理。

### 3.3 新建（v2.2）
新表 + 两条流水线 jobs + 运营新页面 + 学员端浏览下载 + 模型配置页 + AI 适配层。详见下文。

---

## 4. 数据模型（Prisma）

复用现有 `User`。新增以下模型（`@@map` 到 v2.2 §5 的表名；沿用现有 `@map` snake_case 约定；金额/时间用 Int 毫秒）。

```prisma
model SourceVideo {
  id             String       @id @default(uuid())
  douyinShareUrl String       @map("douyin_share_url")
  videoFileUrl   String?      @map("video_file_url")
  status         String       @default("CREATED")       // 见 §5.1 拆解状态机
  createdBy      String?      @map("created_by")
  createdAt      DateTime     @default(now()) @map("created_at")
  transcripts    Transcript[]
  sceneCuts      SceneCut[]
  frameworks     CopyFramework[]
  @@map("source_videos")
}

model Transcript {
  id            String      @id @default(uuid())
  sourceVideoId String      @map("source_video_id")
  source        SourceVideo @relation(fields: [sourceVideoId], references: [id], onDelete: Cascade)
  fullText      String      @map("full_text")
  sentences     Json?       // [{text, startMs, endMs}]
  createdAt     DateTime    @default(now()) @map("created_at")
  @@map("transcripts")
}

model SceneCut {
  id            String      @id @default(uuid())
  sourceVideoId String      @map("source_video_id")
  source        SourceVideo @relation(fields: [sourceVideoId], references: [id], onDelete: Cascade)
  cutPointsMs   Int[]       @map("cut_points_ms")
  @@map("scene_cuts")
}

model CopyFramework {
  id                   String           @id @default(uuid())
  sourceVideoId        String?          @map("source_video_id")
  source               SourceVideo?     @relation(fields: [sourceVideoId], references: [id])
  name                 String?
  industryCategory     String?          @map("industry_category")     // 书单号/好物推荐/...
  visualStyleType      String           @default("ai_illustration") @map("visual_style_type")
  renderTemplate       String?          @map("render_template")       // HyperFrames 模板标识
  overlayTemplate      Json?            @map("overlay_template")       // {title_card, watermark} 占位符
  frameworkText        String           @map("framework_text")
  suggestedSegmentCount Int?            @map("suggested_segment_count")
  maxLines             Int?             @map("max_lines")
  maxTotalChars        Int?             @map("max_total_chars")
  createdBy            String?          @map("created_by")
  createdAt            DateTime         @default(now()) @map("created_at")
  generationTasks      GenerationTask[]
  @@map("copy_frameworks")
}

model GenerationTask {
  id            String            @id @default(uuid())
  frameworkId   String            @map("framework_id")
  framework     CopyFramework     @relation(fields: [frameworkId], references: [id])
  subject       String                                                   // 通用主题：书名/产品名/课程名
  variables     Json?                                                    // overlay 占位符取值
  fullAudioUrl  String?           @map("full_audio_url")
  bodyTimings   Json?             @map("body_timings")                   // [{seqNo, startMs, endMs}]
  status        String            @default("GEN_CREATED")                // 见 §5.2 生成状态机
  createdBy     String?           @map("created_by")
  createdAt     DateTime          @default(now()) @map("created_at")
  updatedAt     DateTime          @updatedAt @map("updated_at")
  segments      GeneratedSegment[]
  renderTasks   RenderTask[]
  @@map("generation_tasks")
}

model GeneratedSegment {
  id               String         @id @default(uuid())
  generationTaskId String         @map("generation_task_id")
  task             GenerationTask @relation(fields: [generationTaskId], references: [id], onDelete: Cascade)
  seqNo            Int            @map("seq_no")
  scriptText       String         @map("script_text")
  imageUrl         String?        @map("image_url")
  @@map("generated_segments")
}

model BgmLibrary {
  id         String       @id @default(uuid())
  fileUrl    String       @map("file_url")
  styleTag   String?      @map("style_tag")
  durationMs Int?         @map("duration_ms")
  renderTasks RenderTask[]
  @@map("bgm_library")
}

model RenderTask {
  id               String          @id @default(uuid())
  generationTaskId String          @map("generation_task_id")
  task             GenerationTask  @relation(fields: [generationTaskId], references: [id], onDelete: Cascade)
  bgmId            String?         @map("bgm_id")
  bgm              BgmLibrary?     @relation(fields: [bgmId], references: [id])
  status           String          @default("RENDERING")
  videoUrl         String?         @map("video_url")
  subtitleUrl      String?         @map("subtitle_url")
  createdAt        DateTime        @default(now()) @map("created_at")
  statusLogs       TaskStatusLog[]
  qcReports        QcReport[]
  @@map("render_tasks")
}

model TaskStatusLog {
  id           String     @id @default(uuid())
  renderTaskId String     @map("render_task_id")
  task         RenderTask @relation(fields: [renderTaskId], references: [id], onDelete: Cascade)
  fromStatus   String?    @map("from_status")
  toStatus     String     @map("to_status")
  note         String?
  createdAt    DateTime   @default(now()) @map("created_at")
  @@map("task_status_logs")
}

model QcReport {
  id           String     @id @default(uuid())
  renderTaskId String     @map("render_task_id")
  task         RenderTask @relation(fields: [renderTaskId], references: [id], onDelete: Cascade)
  checkType    String     @map("check_type")   // black_frame | silence | subtitle_overflow
  result       String                          // pass | fail
  detail       String?
  createdAt    DateTime   @default(now()) @map("created_at")
  @@map("qc_reports")
}

// 模型配置：每种 AI 能力一行，密钥用现有 crypto 加密存储
model AiCapabilityConfig {
  capability String   @id                       // llm | image | tts | asr
  baseUrl    String   @default("") @map("base_url")
  apiKeyEnc  String   @default("") @map("api_key_enc")   // AES-256-GCM
  model      String   @default("")
  enabled    Boolean  @default(false)
  extra      Json?                              // 各能力自有参数（如 TTS voice、图片尺寸/风格）
  updatedAt  DateTime @updatedAt @map("updated_at")
  @@map("ai_capability_config")
}
```

**迁移**：新建一条 Prisma 迁移新增以上表；删旧混剪表的迁移单独一条（切换时执行，见 §12）。

---

## 5. 两条状态机

### 5.1 拆解（source_videos.status）
`CREATED → DOWNLOADING → TRANSCRIBING → SCENE_DETECTING → FRAMEWORK_EXTRACTING → FRAMEWORK_READY`
失败落 `FAILED`（note 记录原因）。手动上传兜底：运营上传视频时直接置 `DOWNLOADING` 完成态跳过解析下载。

### 5.2 生成（generation_tasks.status → 交接 render_tasks.status）
`GEN_CREATED → SCRIPT_GENERATING → IMAGE_GENERATING → TTS_GENERATING → CAPTION_ALIGNING → ASSET_READY`
`ASSET_READY` 起，运营可轻量编辑（换图/改字幕/换BGM/调序；改动后重跑 `CAPTION_ALIGNING`）。
确认合成 → 创建 `RenderTask`：`VISUAL_RENDERING → RENDERING → PREVIEW_PENDING → QC_RUNNING → QC_PASSED → EXPORTED/PUBLISHED`；`QC_FAILED`/预览打回 → 回轻量编辑。
异常（文案校验超重试上限等）落 `FAILED` 交人工。

---

## 6. Worker Jobs（BullMQ）

**拆解**：`download-douyin`（解析分享链→直链→下载到 `/data`；兜底：直接用已上传文件）、`transcribe`（ASR→full_text + sentences 时间戳）、`detect-scenes`（`ffmpeg scene` filter→cut_points_ms）、`extract-framework`（LLM 提炼框架文本+`industry_category`+按分段节奏估算 `max_lines`/`max_total_chars`）。

**生成**：`generate-script`（LLM 按框架生成文案，内部长度校验循环见 §8）、`generate-visuals`（统一入口，按 `visual_style_type` 路由；本期只实现 `generate-image` 逐段文生图，固定风格 prompt）、`generate-tts`（整篇拼接一次性配音→full_audio_url）、`align-captions`（`ffmpeg silencedetect`→按分段数聚合→body_timings）、`render-visuals`（HyperFrames：图片+body_timings+标题卡+水印→视觉片段）、`render-video`（FFmpeg：视觉片段+配音+BGM+音效混音+响度归一化→MP4）、`run-qc`（复用）。

**画面策略路由表**（`visual_style_type` → job）：`ai_illustration → generate-image`（本期）；`material_library`/`digital_human`/`chart_animation` 预留、抛"未实现"。新增行业时只加策略实现并注册，不动通用环节。

---

## 7. AI 适配层（关键新基建）

`packages/db` 或 `worker`/`web` 共享一个 `ai/` 适配层：
- 读取 `AiCapabilityConfig`（解密 key），对四种能力各封装一个 client：`llm.complete()`、`image.generate()`、`tts.synthesize()`、`asr.transcribe()`。
- 每种能力接口不同 → 每个 client 内部按各自端点/请求体/返回解析实现（**待补：4 个接口的请求/返回格式文档**）。
- **Mock 模式**：能力 `enabled=false` 或设 `AI_MOCK=1` 时返回可信假数据（假文案/占位图/静音音频/假转写），保证没接通真实服务也能跑通闭环、便于测试。参照记忆中「每个能力分支 mock、绝不共用」的教训——每个 client 自带 mock，不互相路由。
- 调用失败重试 + 落 `FAILED` + note。

---

## 8. 文案长度校验（generate-script 内）

参考 book-video `validate-script.mjs`：
1. 统计生成文案分段行数、正文总字数。
2. 与框架 `max_lines`/`max_total_chars` 比对。
3. 超限 → LLM 压缩重写 → 再校验，最多 3 次。
4. 达上限仍不过 → 任务 `FAILED` 交运营人工，**不静默放行**。
阈值不写死常量，来自 `extract-framework` 按参考视频反推（不同框架不同阈值）。**待补：用客户真实参考视频校准估算逻辑。**

---

## 9. API 接口

沿用 `handler` + `requireRole('operator')`（运营）/`requireRole()`（学员）。

**拆解**：`POST /api/extract/from-link`、`POST /api/extract/upload`（兜底）、`GET /api/extract/:id`、`GET /api/frameworks`、`GET /api/frameworks/:id`、`PATCH /api/frameworks/:id`。
**生成**：`POST /api/generate`、`GET /api/generate/:id`、`POST /api/generate/:id/segments/:segNo/regenerate`、`PATCH /api/generate/:id/segments/:segNo`、`POST /api/generate/:id/bgm`、`POST /api/generate/:id/render`、`POST /api/generate/:id/retry-qc`、`GET /api/generate/:id/export`。
**BGM**：`GET/POST/DELETE /api/bgm`。
**模型配置**：`GET /api/admin/models`、`PUT /api/admin/models/:capability`、`POST /api/admin/models/:capability/test`（仿 SMTP test）。
**学员端**：`GET /api/library`、`GET /api/works`、`GET /api/works/:id`。

---

## 10. 前端页面

**运营后台**（沿用后台壳/侧栏分组）：`/admin`（仪表盘，指标改数据源）、`/admin/extract`、`/admin/frameworks`、`/admin/generate`、`/admin/generate/[id]/edit`、`/admin/bgm`、`/admin/tasks`（渲染任务+质检）、`/admin/models`（模型配置）、`/admin/settings`(SMTP)、`/admin/account`、`/admin/students`。
侧栏分组建议：概览(仪表盘) / 拆解(拆解·框架库) / 生成(生成·BGM·任务) / 运营(学员数据) / 系统(模型配置·设置·账号)。

**学员端**（只读）：`/`（框架/成片库）、`/works`、`/works/[id]`。

---

## 11. 部署调整
- 渲染算力需求下调（图片轮播+音频合成，非实拍混剪），4 核 8G 起。
- 更依赖外部 AI 接口，出网带宽/并发要求提高；费用走 relay 按量。
- **新增 HyperFrames 依赖**：渲染需 Node + npm registry 访问（`npx hyperframes` 首次拉包）；国内服务器要配好 npm 镜像/代理（已有 npmmirror，验证 hyperframes 可拉）。
- 沿用 `docker-compose.prod.yml` + Caddy + 国内构建镜像源。GPU 不需要。

---

## 12. 切换策略（新产品取代东方文澜）
- 同仓库演进：新代码在长期分支上做；线上东方文澜继续运行不受影响。
- P1 出片验证 OK → 决定切换时点：执行「删旧混剪表」迁移 + 部署新代码 + 新 schema（`generation_tasks` 等）。
- 因线上真实用户/数据不多且属早期，切换采用新 schema 全量替换；如需保留旧数据另行导出备份。
- 产品名/品牌是否从「东方文澜」改名，切换前定。

---

## 13. 建议分期（build order，非范围裁剪；完全体全做）
| 阶段 | 内容 | 里程碑产出 |
|---|---|---|
| **P0 基座** | 拆旧 + 新 schema/迁移 + `/admin/models` + AI 适配层(4 client + mock) + 后台壳保留 + 状态机/日志/QC 接线 | 空壳可跑、能配模型、mock 闭环通 |
| **P1 生成线** | 用手工框架跑通 `generate-script`(+校验)→`generate-image`→`generate-tts`→`align-captions`→`render-visuals`(HyperFrames)→`render-video`→`run-qc`→发布；`/admin/generate`+`/edit` | **产出第一条真实 AI 生成视频** |
| **P2 拆解线** | `download-douyin`+上传兜底→`transcribe`→`detect-scenes`→`extract-framework`；`/admin/extract`+`/admin/frameworks` | 拆解自动产框架喂生成 |
| **P3 打磨** | `/admin/bgm`、`/admin/tasks`、框架库/生成页完善、学员端浏览下载、仪表盘数据源、切换上线 | 完整闭环可用、上线 |

每阶段照现有节奏：分支→实现→tsc+测试+生产构建→PR→合并→（择机）部署。

---

## 14. 非目标（本期不做）
- 跨行业第二垂类的画面策略实现（仅架构预留 `visual_style_type` 路由）。
- 学员端编辑器（换图/改字幕/换BGM 的学员自助界面）。
- BGM 智能情绪匹配、插画 LoRA 风格定制、学员 token 计费（v2.2 §10 Phase 2–4）。
- OSS/COS 实际接入（仅留可插拔层）。
- 抖音批量自动爬取（仅半自动单条）。

---

## 15. 待确认/待补（开工前或对应阶段前）
1. **4 个 AI 能力的接口文档**（各自 端点/请求体/返回格式）——实现适配层 client 必需。P0 需要。
2. **文案阈值校准**：用客户真实参考视频跑 `extract-framework` 估算逻辑验证（§8）。P2 前。
3. **文生图风格 prompt 模板**：保证同素材包多图风格统一；是否针对客户品牌调优。P1 前。
4. **BGM 来源**：MVP 固定曲库随机/按 style_tag 选取（本 spec 默认此法）；是否要情绪匹配（否，Phase 3）。
5. **抖音解析可行性**：自研解析分享链的具体方法/成功率；兜底手动上传已定。P2 前验证。
6. **HyperFrames 模板**：书单号模板（图片轮播动效+标题卡+水印）来源——套用 book-video 模板还是自建。P1 前。
7. **产品品牌/命名**：切换上线前定。
