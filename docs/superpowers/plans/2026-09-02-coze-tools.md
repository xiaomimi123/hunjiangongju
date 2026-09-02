# 扣子（Coze）工作流工具箱 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 运营在后台填 workflow_id 即可把扣子工作流上架成学员端小工具：学员填表单 → 扣积分 → worker 调扣子 → 通用结果页展示。

**Architecture:** 新增 `CozeTool` / `CozeToolRun` 两表；扣子客户端放 `packages/db/src/ai/coze.ts`（与 dashscope 同级，fetch 可注入便于测试）；worker 新增独立 BullMQ 队列 `coze-run`（并发 2，不与渲染抢）；输出解析是纯函数（raw JSON → outputItems），远程文件一律转存 `data/coze/<runId>/`；积分沿用「事务内 updateMany 并发闸」模式，失败幂等退回。

**Tech Stack:** Next.js 14 App Router / Prisma 5 / BullMQ / Node 20 内置 fetch（不加新依赖）

**Spec:** `docs/superpowers/specs/2026-09-02-coze-tools-design.md`

## Global Constraints

- 测试命令统一带库：`DATABASE_URL='postgresql://mixcut:mixcut@localhost:55433/mixcut' npm test`；本地库没起先 `DOCKER_BUILDKIT=0 docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d postgres`。
- **零回归判据：`npm test` 必须 0 failed**（当前基线 0 failed / 1225 passed）。
- 类型检查基线：`npx tsc --noEmit -p web/tsconfig.json` = **37**；`-p worker/tsconfig.json` = **0**。不许上涨。
- 提交信息中文 `type(scope): 摘要 —— 说明`；**绝不写 Co-Authored-By 尾注**。
- **源码不许出现任何不可见控制字符**（本仓曾因裸 NUL 让 git 把测试文件永久判成二进制）。
- **不装任何新依赖**（HTTP 用 Node 20 内置 fetch）。
- **web 侧客户端组件从 `@mixcut/db` 导入必须走子模块路径**（如 `@mixcut/db/src/booklist/xxx`），绝不能走包索引 —— 包索引会把 bullmq 拖进客户端 bundle 导致整页白屏（本仓踩过）。API 路由（服务端）不受此限。
- 数据库迁移**手写 SQL**（本地库有历史漂移，`prisma migrate dev` 会要求重置 schema，**绝不接受**）：只允许 CREATE TABLE / ADD COLUMN，生成后逐行检查，应用用 `prisma migrate deploy` 或 `db execute` + `migrate resolve --applied`，再 `prisma generate`。
- 学员上传：类型白名单 jpg/png/webp、上限 10MB、`randomUUID()` 随机文件名落盘（防路径穿越，与字体上传同口径）。
- 扣子返回的文件 URL 是临时签名会过期，**必须转存本站再展示**。

---

## 文件结构

- `packages/db/prisma/schema.prisma` — 加 `CozeTool` / `CozeToolRun` 两模型
- `packages/db/src/ai/config.ts` — `Capability` 加 `'coze'`
- `packages/db/src/ai/coze.ts`（新）— 扣子客户端三函数
- `packages/db/src/ai/cozeOutput.ts`（新）— 纯函数：raw → outputItems
- `packages/db/src/cozeQueue.ts`（新）— `enqueueCozeRun(runId)`
- `web/app/api/admin/coze-tools/**` — 后台 CRUD + 拉参数代理 + 运行记录
- `web/app/api/tools/**` — 学员端列表/详情/运行/上传/记录
- `web/app/admin/coze-tools/page.tsx` — 后台管理页
- `web/components/SidebarNav.tsx` — 加入口
- `web/app/(student)/tools/**` — 广场/工具页/结果页
- `web/app/(student)/page.tsx` — 首页加「工具广场」板块
- `worker/src/coze/run.ts`（新）+ `worker/src/index.ts` — 队列消费

---

### Task 1: Spike —— 用真实 Token 验证扣子三接口

**Files:** 只产出结论文档 `docs/superpowers/references/coze-api-spike.md`，不写生产代码。

**⚠️ 需要用户提供**：扣子 PAT Token 与一个测试 workflow_id（问控制者要；用户说过「配到后台即可，不用发我」——spike 时让用户配好后从库里读，或用户临时提供）。**拿不到 Token 时**：把三项全记为「未验证」，照常继续后续任务（设计已按手动兜底堵死），不阻塞。

- [ ] **Step 1: 逐项验证并记录**（curl 或临时脚本，跑完即删）
  1. `POST {base}/v1/workflow/run`（`Authorization: Bearer <PAT>`，body `{workflow_id, parameters}`）→ 记录返回 JSON 的真实结构（`code/msg/data` 包裹？`data` 是字符串还是对象？）
  2. `POST {base}/v1/files/upload`（multipart `file`）→ 记录 file_id 字段名与「参数里怎么引用 file_id」（扣子图片参数通常要 `{"file_id":"xxx"}` 串）
  3. 拉参数接口是否存在（试 `GET /v1/workflows/{id}` 等候选）→ 存在则记录 schema 形状；不存在记「无此接口，走手动兜底」
- [ ] **Step 2: 写结论文档并提交**
  `docs/superpowers/references/coze-api-spike.md`：三项各一节，贴脱敏后的真实返回样例。后续任务以此文档为准；**若与本计划中我预写的请求/响应形状不符，以 spike 结论为准并在实现处注明**。
```bash
git add docs/superpowers/references/coze-api-spike.md && git commit -m "docs(coze): spike 结论 —— run/upload/参数拉取三接口实测"
```

---

### Task 2: 数据模型 + capability 注册

**Files:**
- Modify: `packages/db/prisma/schema.prisma`
- Create: `packages/db/prisma/migrations/<ts>_coze_tools/migration.sql`（手写）
- Modify: `packages/db/src/ai/config.ts:4-5`

**Interfaces (Produces):** `prisma.cozeTool` / `prisma.cozeToolRun`；`Capability` 含 `'coze'`。

- [ ] **Step 1: schema 加两模型**（字段与 spec 逐字一致；沿用现有 `@map` snake_case 风格）：

```prisma
/// 后台导入的扣子工作流工具。学员端「工具广场」按 enabled + sortOrder 展示。
model CozeTool {
  id           String   @id @default(cuid())
  name         String
  description  String   @default("")
  workflowId   String   @map("workflow_id")
  /// [{ name, label, type: 'text'|'textarea'|'select'|'image', options?, placeholder?, required }]
  inputs       Json
  priceCredits Int      @default(1) @map("price_credits")
  enabled      Boolean  @default(false)
  sortOrder    Int      @default(0) @map("sort_order")
  createdAt    DateTime @default(now()) @map("created_at")
  @@map("coze_tools")
}

/// 学员的每次运行。软引用 user/tool（与仓库现有风格一致，应用层校验）。
model CozeToolRun {
  id          String    @id @default(cuid())
  toolId      String    @map("tool_id")
  userId      String    @map("user_id")
  inputs      Json
  status      String    @default("QUEUED")
  outputRaw   Json?     @map("output_raw")
  outputItems Json?     @map("output_items")
  errorMsg    String?   @map("error_msg")
  creditsCost Int       @map("credits_cost")
  refunded    Boolean   @default(false)
  createdAt   DateTime  @default(now()) @map("created_at")
  finishedAt  DateTime? @map("finished_at")
  @@index([userId, createdAt])
  @@map("coze_tool_runs")
}
```
（`refunded` 是退积分的幂等闸，spec 里「只退一次」靠它落地。）

- [ ] **Step 2: 手写迁移 SQL**（两条 CREATE TABLE + 一条 CREATE INDEX，别的什么都不许有），用 `prisma migrate diff --from-schema-datasource --to-schema-datamodel --script` 生成后**删掉一切非本表语句**，`db execute` 应用 + `migrate resolve --applied` + `prisma generate`。
- [ ] **Step 3: `Capability` 加 `'coze'`**：
```ts
export type Capability = 'llm' | 'image' | 'tts' | 'asr' | 'vision' | 'coze'
export const CAPABILITIES: Capability[] = ['llm', 'image', 'tts', 'asr', 'vision', 'coze']
```
确认 `/admin/models` 页因此自动多一行（该页遍历 CAPABILITIES；去读确认，若有 per-capability 文案表也补上「扣子」一项）。
- [ ] **Step 4: 全量测试 + tsc 基线** → 0 failed / 37 / 0
- [ ] **Step 5: 提交** `feat(coze): CozeTool/CozeToolRun 两表 + capability 注册`

---

### Task 3: 扣子 API 客户端（fetch 可注入）

**Files:**
- Create: `packages/db/src/ai/coze.ts` / `packages/db/src/ai/coze.test.ts`
- Modify: `packages/db/src/ai/index.ts`（导出）

**Interfaces (Produces):**
```ts
export type CozeFetch = typeof fetch
export async function cozeRunWorkflow(workflowId: string, parameters: Record<string, unknown>,
  opts?: { fetchImpl?: CozeFetch; timeoutMs?: number }): Promise<{ raw: unknown }>
export async function cozeUploadFile(buf: Buffer, filename: string,
  opts?: { fetchImpl?: CozeFetch }): Promise<{ fileId: string }>
export async function cozeFetchWorkflowParams(workflowId: string,
  opts?: { fetchImpl?: CozeFetch }): Promise<{ name: string; type?: string; required?: boolean }[] | null>
```
三者内部都先 `getCapabilityConfig('coze')` 取 baseUrl/apiKey；未配置或未启用 → 抛中文错误（「扣子未配置，请在模型配置里填 Token」）。`cozeFetchWorkflowParams` 拿不到（接口不存在/无权限）返回 `null` 而不抛——那是预期路径（手动兜底）。请求/响应形状**以 Task 1 spike 文档为准**；spike 未做时按上面签名 + `data` 字段兜底解析实现，注明待验证。

- [ ] **Step 1: 失败测试**（fetchImpl 注入假响应；覆盖：成功解析 / 扣子返回 code!=0 抛中文错 / 未配置抛「扣子未配置」/ 超时抛错 / FetchWorkflowParams 404 → null）
- [ ] **Step 2-4: TDD 循环** → 全绿
- [ ] **Step 5: 提交** `feat(coze): 扣子 API 客户端 —— run/upload/拉参数，fetch 可注入`

---

### Task 4: 输出解析纯函数

**Files:** Create `packages/db/src/ai/cozeOutput.ts` / `cozeOutput.test.ts`

**Interfaces (Produces):**
```ts
export type CozeOutputItem =
  | { kind: 'text'; text: string }
  | { kind: 'image' | 'video' | 'file'; url: string }   // url 此时还是扣子远程 URL，转存是 worker 的事
export function parseCozeOutput(raw: unknown): CozeOutputItem[]
```
规则（写进注释）：`raw` 若是 JSON 字符串先 parse；深度遍历对象/数组；字符串值中——
以 http(s) 开头且路径命中 `.jpg/.jpeg/.png/.webp/.gif` → image，`.mp4/.mov/.webm` → video，其它 URL → file；
非 URL 且 trim 后长度 ≥ 2 的字符串 → text（同一段只收一次，去重）；数字/布尔忽略。
识别不出任何项时返回 `[]`（前端兜底展示 outputRaw）。

- [ ] **Step 1: 失败测试**（≥6 例：纯文本对象 / data 为 JSON 字符串 / 图片 URL / 视频 URL / 混合嵌套数组 / 空对象→[] / URL 带 query 仍按路径后缀识别）
- [ ] **Step 2-4: TDD** → 全绿
- [ ] **Step 5: 提交** `feat(coze): 输出解析纯函数 —— raw JSON 规整为展示项`

---

### Task 5: 后台 API（CRUD + 拉参数代理 + 运行记录）

**Files:**
- Create: `web/app/api/admin/coze-tools/route.ts`（GET 列表 / POST 新建）
- Create: `web/app/api/admin/coze-tools/[id]/route.ts`（PATCH 编辑、上下架 / DELETE）
- Create: `web/app/api/admin/coze-tools/fetch-params/route.ts`（POST {workflowId} → 调 cozeFetchWorkflowParams，null 时返回 `{ params: null, hint: '扣子未提供参数查询，请手动添加输入项' }`）
- Create: `web/app/api/admin/coze-tools/runs/route.ts`（GET 全部运行，倒序分页）
- Create: `web/app/api/admin/coze-tools/route.test.ts`

全部 `requireRole('operator')`。`inputs` 服务端校验：数组、每项 `name` 非空且 `/^[\w-]{1,64}$/`、`type` 在四值白名单、select 必须给非空 `options`；`priceCredits` 夹到 [0, 1000] 整数。DELETE：有运行记录的工具不物理删，置 `enabled=false` 并返回提示（与 BGM 被引用跳过同思路）。

- [ ] **Step 1: 失败测试**（照 `web/app/api/admin/fonts/route.test.ts` 的 mock 写法：非 operator 401/403；inputs 非法 400；合法创建回读一致；DELETE 有 run 时不删只下架）
- [ ] **Step 2-4: TDD** → 全绿
- [ ] **Step 5: 提交** `feat(admin): 扣子工具 CRUD + 拉参数代理 + 运行记录接口`

---

### Task 6: 后台管理页 + 侧边栏入口

**Files:**
- Create: `web/app/admin/coze-tools/page.tsx`
- Modify: `web/components/SidebarNav.tsx`（「生成」组下加「扣子工具」）

照 `web/app/admin/settings/fonts/page.tsx` 的列表+表单风格（PageHeader/card/btn-*/pill-*，裸 useState，不引表单库）。编辑表单：名称/描述/workflow_id/价格/排序/上下架 + 输入项动态列表（参数名/中文标签/类型下拉/必填勾选/select 的选项逗号分隔）+「从扣子拉取参数」按钮（成功则填充列表让运营补标签；返回 null 显示 hint 并保持手动模式）。

- [ ] **Step 1: 实现**（本任务无单测，靠 Task 5 的 API 测试 + 收尾真实浏览器验收；tsc 必须干净）
- [ ] **Step 2: `npm test` 0 failed + tsc 37/0**
- [ ] **Step 3: 提交** `feat(admin): 扣子工具管理页 —— 导入/编辑/上下架`

---

### Task 7: 学员端 API（列表/详情/上传/运行/记录）

**Files:**
- Create: `web/app/api/tools/route.ts`（GET：enabled 工具，字段只给 id/name/description/priceCredits/inputs）
- Create: `web/app/api/tools/upload/route.ts`（POST multipart：jpg/png/webp、≤10MB、`randomUUID()` 落盘 `DATA_DIR/coze-uploads/`，返回 `{ rel: 'coze-uploads/<uuid>.<ext>' }`）
- Create: `web/app/api/tools/[id]/run/route.ts`（POST）
- Create: `web/app/api/tools/runs/route.ts`（GET 本人列表，倒序，limit 50）
- Create: `web/app/api/tools/runs/[id]/route.ts`（GET 本人单条；非本人 404；operator 可看全部）
- Create: `packages/db/src/cozeQueue.ts`（`enqueueCozeRun(runId: string)`，照 genQueue 的 Queue 缓存写法，队列名 `'coze-run'`）
- Create: `web/app/api/tools/run.test.ts`

**run 路由核心**（积分事务照 `web/app/api/generate/route.ts:52-63` 的并发闸原样搬，逐行注释保留）：
```ts
const s = await requireRole()
checkRate('coze-run', s.userId, 10)                       // 10 次/分钟防刷
const tool = await prisma.cozeTool.findUnique({ where: { id: params.id } })
if (!tool || !tool.enabled) throw new HttpError(404, '工具不存在或已下架')
const inputs = validateInputsAgainst(tool.inputs, body.inputs)  // 逐项校验：必填、select 值在 options 内、image 是本站 coze-uploads 相对路径
const run = await prisma.$transaction(async (tx) => {
  if (s.role !== 'operator' && tool.priceCredits > 0) {
    const claimed = await tx.user.updateMany({
      where: { id: s.userId, credits: { gte: tool.priceCredits } },
      data: { credits: { decrement: tool.priceCredits } },
    })
    if (claimed.count === 0) {
      const exists = await tx.user.count({ where: { id: s.userId } })
      if (exists > 0) throw new HttpError(403, '积分已用完，请扫码联系导师充值', 'NO_CREDITS')
    }
  }
  return tx.cozeToolRun.create({ data: {
    toolId: tool.id, userId: s.userId, inputs, creditsCost: s.role === 'operator' ? 0 : tool.priceCredits,
  } })
})
await enqueueCozeRun(run.id)
return NextResponse.json({ id: run.id })
```
`validateInputsAgainst` 是导出的纯函数（同文件或 `web/lib/cozeInputs.ts`），单测覆盖。

- [ ] **Step 1: 失败测试**（未登录 401；下架 404；积分不足 NO_CREDITS 且**未建 run**；operator 免扣；image 路径不在 coze-uploads/ 下 400（路径穿越）；成功后 run 的 creditsCost 正确）
- [ ] **Step 2-4: TDD** → 全绿
- [ ] **Step 5: 提交** `feat(tools): 学员端扣子工具接口 —— 扣分并发闸 + 入队`

---

### Task 8: worker 队列消费

**Files:**
- Create: `worker/src/coze/run.ts` / `worker/src/coze/run.test.ts`
- Modify: `worker/src/index.ts`（`startCozeWorker()`）

**流程**（依赖全部可注入，测试不打真扣子）：
```ts
export async function processCozeRun(runId: string, deps = defaultDeps): Promise<void>
```
1. run 置 RUNNING；查 tool（没了→FAILED 退分）
2. 遍历 tool.inputs 里 type==='image' 的字段：读 `DATA_DIR/<rel>` → `deps.uploadFile` 换 fileId → 参数值按 spike 文档的引用格式写入
3. `deps.runWorkflow(tool.workflowId, parameters)`（超时 10 分钟）
4. `parseCozeOutput(raw)` → 对 image/video/file 项 `deps.download` 转存 `DATA_DIR/coze/<runId>/<uuid>.<ext>`（≤200MB/文件，超限记 file 项但不转存并注明），fileUrl 改 `/api/files/coze/<runId>/<name>`
5. 成功：SUCCEEDED + outputRaw + outputItems + finishedAt
6. **任何失败**：FAILED + errorMsg + 退积分——幂等靠 `updateMany({ where: { id: runId, refunded: false, creditsCost: { gt: 0 } }, data: { refunded: true } })` 抢到才 `credits: { increment: creditsCost }`（同一事务）
`startCozeWorker()`：`new Worker('coze-run', job => processCozeRun(job.data.runId), { connection, concurrency: 2 })`，照 gen worker 的 attach 错误处理。

- [ ] **Step 1: 失败测试**（注入假 deps：成功链路各字段落库正确；runWorkflow 抛错 → FAILED + 积分退回；**重复调 processCozeRun 同一失败 run，积分只退一次**；image 字段走了 uploadFile；转存后 fileUrl 是本站路径）
- [ ] **Step 2-4: TDD** → 全绿
- [ ] **Step 5: 提交** `feat(worker): coze-run 队列 —— 运行/转存/失败幂等退分`

---

### Task 9: 学员端页面

**Files:**
- Create: `web/app/(student)/tools/page.tsx`（广场：工具卡片 + 我的记录入口）
- Create: `web/app/(student)/tools/[id]/page.tsx`（表单：text→input、textarea→textarea、select→select、image→文件选择即传 `/api/tools/upload`；顶部价格+余额；提交→跳结果页；NO_CREDITS 弹现有充值二维码组件——去 `web/app/(student)` 里找现有弹窗的用法照搬）
- Create: `web/app/(student)/tools/runs/[id]/page.tsx`（3s 轮询到 SUCCEEDED/FAILED 停；outputItems 渲染：text=段落+复制按钮、image=<img>+下载、video=<video controls>+下载、file=下载链接；items 空时折叠展示 outputRaw JSON；FAILED 显示 errorMsg + 「积分已退回」）
- Modify: `web/app/(student)/page.tsx`（「工具广场」板块：拉 `/api/tools` 前 4 个宫格 + 「全部工具」链接；无 enabled 工具时整个板块不渲染）

沿用学员端现有样式类与 `api()` fetcher；轮询写法照 `works/[id]/page.tsx`（isSettled 停表那套）。

- [ ] **Step 1: 实现 + tsc 干净 + `npm test` 0 failed**
- [ ] **Step 2: 提交** `feat(student): 工具广场 —— 广场/工具表单/结果页/首页入口`

---

### Task 10: 文档 + 收尾验收

- [ ] **Step 1: README**「功能概览」加扣子工具箱一条（管理员端 + 学员端各一句；只写已实现的）
- [ ] **Step 2: 部署文档** `deploy/DEPLOY-coze-tools.md`（照 DEPLOY-subtitle-font-stage.md 格式）：新迁移两张表；`data/coze/`、`data/coze-uploads/` 目录；模型配置页需配扣子 Token 才能用；无新环境变量
- [ ] **Step 3: 真实浏览器收尾验收**（起 dev server + 真 Token，逐条记录）：后台导入真实工作流 → 学员端跑通一次 → 结果正确展示 → 积分扣/退正确 → 下架后广场消失
- [ ] **Step 4: 提交** `docs: 扣子工具箱 README + 部署清单`

---

## 收尾检查清单

- [ ] `npm test` 0 failed；tsc web 37 / worker 0
- [ ] 学员 A 看不到学员 B 的 run（越权测试）
- [ ] 积分：不足时 NO_CREDITS 且不建 run；失败退回且只退一次
- [ ] 扣子 Token 未配置时：学员端提交得到明确中文报错，不是 500 堆栈
- [ ] 部署：迁移自动应用、data 子目录、README/部署文档齐
