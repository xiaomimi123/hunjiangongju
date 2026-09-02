# 扣子（Coze）工作流工具箱 —— 设计

日期：2026-09-02
涉及：后台管理（导入/管理工具）、学员端（工具广场）、worker（运行队列）

---

## 背景与目标

运营在扣子（Coze）平台上搭好各类内容工作流（文案改写、标题生成等），希望**不写代码**
就能把它们上架给学员用：后台填一个 workflow_id 导入 → 学员端多一个小工具。

- 每个工作流是一个独立小工具：学员选工具 → 填表单 → 运行 → 拿结果
- 每个工具可配价格（N 积分/次），沿用现有积分体系（余额不足弹充值二维码）
- 全站一个扣子 PAT Token，沿用 `ai_capability_config` 的加密存储
- 输出形态不定（文本/图片/视频都可能），按通用形态处理

## 数据模型（新增 2 表）

```prisma
/// 后台导入的扣子工作流工具。学员端「工具广场」按 enabled + sortOrder 展示。
model CozeTool {
  id           String   @id @default(cuid())
  name         String            // 学员看到的工具名
  description  String   @default("")
  workflowId   String            // 扣子工作流 id
  /// 输入表单定义：[{ name, label, type: 'text'|'textarea'|'select'|'image',
  ///   options?: string[], placeholder?, required }]
  /// name 对应扣子工作流的参数名；label/type/options 由运营配置（自动拉取后可改，或全手动）。
  inputs       Json
  priceCredits Int      @default(1)   // 每次运行消耗积分
  enabled      Boolean  @default(false)
  sortOrder    Int      @default(0)
  createdAt    DateTime @default(now())
}

/// 学员的每次运行。
model CozeToolRun {
  id          String    @id @default(cuid())
  toolId      String
  userId      String
  inputs      Json               // 提交参数快照（image 类型存本站文件相对路径）
  status      String    @default("QUEUED")  // QUEUED / RUNNING / SUCCEEDED / FAILED
  outputRaw   Json?              // 扣子原始返回（排查用）
  /// 规整后的展示项：[{ kind: 'text'|'image'|'video'|'file', text?, fileUrl? }]
  /// fileUrl 指向本站 /api/files/coze/...（扣子的 URL 会过期，必须转存）
  outputItems Json?
  errorMsg    String?
  creditsCost Int                // 扣了多少分（失败退回时按它退）
  createdAt   DateTime  @default(now())
  finishedAt  DateTime?
}
```

不加外键约束到 users/CozeTool（与仓库现有风格一致：软引用 + 应用层校验）。

## 凭据

`ai_capability_config` 新增 capability `coze`：`base_url` 默认 `https://api.coze.cn`，
`api_key_enc` 存加密 PAT。后台「模型配置」页多一行，复用现有编辑/加密逻辑，
不另起一套密钥管理。

## 扣子 API 客户端（packages/db/src/ai/ 下，与 dashscope 客户端同级）

- `cozeRunWorkflow(workflowId, parameters)`：`POST /v1/workflow/run`，非流式、等完成，
  超时上限 10 分钟。**worker 里长等没有 HTTP 超时问题，不依赖扣子的异步运行支持。**
- `cozeUploadFile(buf, filename)`：`POST /v1/files/upload` 换 file_id（图片输入用；
  不走公网签名 URL 回源，不依赖 PUBLIC_BASE_URL 可达性）。
- `cozeFetchWorkflowParams(workflowId)`：尝试拉取工作流参数定义。
  ★ **该接口是否存在是本设计最大的未知**——实施第一步用真实 Token spike 验证；
  设计已按「拉不到可手动配」兜底，不会被堵死。

## 后台（/admin/coze-tools）

- 列表页：名称 / 价格 / 上下架开关 / 运行次数 / 编辑 / 删除（删除需无运行记录或软处理）
- 新建/编辑：填 workflow_id → 「从扣子拉取参数」按钮（拉到自动列出；拉不到手动逐个添加）
  → 每个参数补中文标签、类型（单行/多行/下拉/图片）、必填、下拉选项 → 配价格 → 保存
- 运行记录页：全部学员的运行列表（状态/耗时/报错），排查用
- 侧边栏「生成」组下加「扣子工具」入口

## 学员端

- 首页新增「工具广场」宫格板块（enabled 的工具，按 sortOrder）→ `/tools` 广场页
- `/tools/[id]` 工具页：按 `inputs` 渲染表单（text/textarea/select/image 四种控件），
  顶部显示价格与我的余额；提交 → 扣分 → 建 run → 跳结果页
- `/tools/runs/[id]` 结果页：轮询状态（3s，与作品详情页同节奏）；
  成功后按 outputItems 渲染：文本=段落+复制，图片=预览+下载，视频=播放器+下载，
  识别不了=原始 JSON 折叠展示
- `/tools` 页带「我的记录」入口（本人历史运行列表）
- 图片输入：学员端上传到本站临时目录（大小/类型限制沿用素材上传口径），
  run 的 inputs 里存相对路径，由 worker 换 file_id
- 积分：提交时事务内校验+扣减；**运行失败自动退回**（区别于「删任务不返还」——
  失败是平台问题，不该学员买单）；NO_CREDITS 走现有充值二维码弹窗

## Worker（新增 BullMQ 队列 coze-run）

扣分成功 → 入队 → worker：
1. 状态 RUNNING
2. image 类输入：读本站文件 → cozeUploadFile 换 file_id → 并入 parameters
3. cozeRunWorkflow 等结果（≤10 分钟）
4. 解析输出为 outputItems：遍历返回 JSON，长文本字段 → text 项；
   URL 字段按扩展名/HEAD content-type 识别 image/video/file → **下载转存 `data/coze/<runId>/`**
   （扣子 URL 是临时签名，会过期）→ fileUrl 指本站
5. 成功 SUCCEEDED；任何失败 FAILED + errorMsg + **退回积分**（幂等：只退一次）

## 安全与限制

- 学员只能看自己的 run；运营可看全部
- 上传文件：类型白名单（图片 jpg/png/webp）、大小上限 10MB、随机文件名落盘（防路径穿越，
  与字体上传同口径）
- 每学员运行频率限流（沿用 checkRate，如 10 次/分钟），防止积分被盗刷后高速消耗扣子额度
- 工具下架后：已有 run 可看，不能新建

## 明说的风险

1. 参数拉取接口未验证 → spike + 手动兜底
2. 输出 JSON 结构因工作流而异 → 通用识别 + 原始 JSON 兜底，第一版不追求完美识别
3. 长工作流占 worker 并发 → coze-run 队列单独并发度（如 2），不与视频渲染抢

## 实施顺序

1. spike：真 Token 验证 run / upload / 参数拉取三个接口（半天内出结论）
2. 表 + 凭据 + 扣子客户端（mock 测试）
3. 后台管理页
4. worker 队列 + 输出解析转存
5. 学员端（广场/工具页/结果页/积分）
6. 真实工作流端到端验收
