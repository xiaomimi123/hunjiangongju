# 学员端移动版改版 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 学员端移动优先改版（深色头部+轮播+工具宫格+视频卡片+5格底导航）、后台导航瘦身与生成列表卡片化、扣子参数自动探测。

**Architecture:** 纯前端重排为主 + 两个小后端增量（Banner 表与 CRUD、probe-params 探测接口）。共享 VideoCard 组件四处复用。不碰渲染链路/积分/登录。

**Tech Stack:** Next.js 14 App Router、Prisma 5、Tailwind（现有 token）、vitest。

**Spec:** docs/superpowers/specs/2026-09-03-mobile-revamp-design.md（样稿：见任务派发时给的 mockup HTML 路径，CSS 数值以样稿为准）

## Global Constraints

- 迁移禁用 `prisma migrate dev`：手写 SQL → `prisma db execute` → `migrate resolve --applied` → `prisma generate`。
- 客户端组件禁止 import '@mixcut/db' 包索引（bullmq 入 bundle 白屏）；需要共享常量走子模块路径。
- 图标一律线性 SVG（stroke=currentColor, stroke-width=2, fill=none），**禁止任何 emoji 字符**出现在学员端/后台 UI。
- 品牌色沿用 tailwind token（flame/#e60012、grad 渐变、ink 系列）；深色头部仅首页。
- 测试命令：`DATABASE_URL='postgresql://mixcut:mixcut@localhost:55433/mixcut' JWT_SECRET='dev-secret-change-me' npx vitest run <files>`；提交前跑受影响文件。
- 学员接口一律 requireRole('STUDENT'/任意登录)，错误返回 `{ error: { code, message } }` 沿用现有 HttpError 约定。
- 不删除 extract/books 页面代码，只动 SidebarNav。
- 每任务独立提交，提交信息中文，禁止 Co-Authored-By 尾注。

---

### Task 1: Banner 表 + 后端接口

**Files:**
- Modify: `packages/db/prisma/schema.prisma`（追加 model Banner）
- Create: `packages/db/prisma/migrations/20260903100000_banners/migration.sql`
- Create: `web/app/api/admin/banners/route.ts`（GET 列表含禁用 / POST 新建）
- Create: `web/app/api/admin/banners/[id]/route.ts`（PATCH / DELETE）
- Create: `web/app/api/banners/route.ts`（学员 GET：enabled 按 sortOrder asc, id asc）
- Test: `web/app/api/admin/banners/route.test.ts`

**Interfaces:**
- Produces: Banner `{ id, title, body, linkUrl, enabled, sortOrder, createdAt }`；学员 GET 返回 `{ banners: [{ id, title, body, linkUrl }] }`（不含 enabled/sortOrder）。

**Schema:**
```prisma
model Banner {
  id        String   @id @default(cuid())
  title     String
  body      String   @default("")
  linkUrl   String?
  enabled   Boolean  @default(true)
  sortOrder Int      @default(0)
  createdAt DateTime @default(now())
  @@map("banners")
}
```

- [ ] 迁移 SQL 手写（CREATE TABLE banners，列同上，TEXT/BOOLEAN/INT/TIMESTAMP），按 Global Constraints 应用
- [ ] 校验：title 1~60 字、body ≤200 字、linkUrl 若给必须 `/` 开头站内路径或 https URL、sortOrder 0~999 整数；不合法 400
- [ ] admin 路由 requireRole('ADMIN')；学员路由任意登录即可
- [ ] 测试至少：新建成功、title 超长 400、学员 GET 不返回 disabled 条目与内部字段、PATCH 启停、DELETE
- [ ] 提交

### Task 2: 后台导航瘦身 + 公告 Banner 管理页

**Files:**
- Modify: `web/components/SidebarNav.tsx`
- Create: `web/app/admin/banners/page.tsx`

**Interfaces:** Consumes Task 1 的 admin CRUD。

- [ ] SidebarNav：删「视频拆解」「书库」两项；「拆解 / 复刻」组改名「复刻」；「运营」组加 `{ href: '/admin/banners', label: '公告 Banner', icon: 'doc' }`
- [ ] 管理页：列表（标题/正文摘要/排序/启停开关/删除确认）+ 顶部「新增」内联表单（title/body/linkUrl/sortOrder）；风格照 /admin/coze-tools 现有卡片式写法
- [ ] 提交

### Task 3: VideoCard 组件 + 成片库卡片化

**Files:**
- Create: `web/components/VideoCard.tsx`
- Modify: `web/app/(student)/library/page.tsx`

**Interfaces:**
- Produces:
```ts
export type VideoCardProps = {
  src: string | null            // 视频 URL；null=无成片（进行中/失败）
  title: string
  subtitle?: string             // 副信息行左侧
  trailing?: React.ReactNode    // 副信息行右侧（下载链接等）
  badge?: { text: string; tone: 'ok' | 'run' | 'bad' }
  overlayTitle?: string         // 海报下方叠加标题（可选）
  posterClassName?: string      // 无视频时的渐变占位类
  onClick?: () => void
  footer?: React.ReactNode      // 后台版操作按钮排
}
```
- 海报：有 src 时 `<video preload="metadata" playsInline muted src={src+'#t=0.1'}>` 显示首帧；点击后原地切换为 controls 播放（内部 state）。无 src 用渐变占位 + 降透明播放钮。
- 时长角标：video 元数据 loadedmetadata 后显示 `mm:ss`。
- 播放钮为内联 SVG 三角，badge 色值照样稿（ok rgba(15,183,126,.92) 等）。

- [ ] 成片库页：顶部筛选 chips（全部/书单成片/工具产出）；数据=现有 `/api/library/works` + `/api/tools/runs` 里 SUCCEEDED 且 outputItems 含 kind==='video' 的项（每项取第一个 video url，标题用工具名+输入摘要，跳转 `/tools/runs/[id]`）；两组客户端合并按时间倒序
- [ ] 双列 grid（`grid-cols-2`，sm 以上 3~4 列）；下载沿用 `?download=1`
- [ ] 提交

### Task 4: 学员端骨架 —— 5 格底导航 + 首页改版

**Files:**
- Modify: `web/app/(student)/layout.tsx`（TabBar 5 格：首页/框架/做片凸起/工具/我的；做片跳 /templates）
- Modify: `web/app/(student)/page.tsx`（整页重排）

**Interfaces:** Consumes `/api/banners`（Task 1）、`/api/tools`、`/api/generate`、`/api/credits`、VideoCard（Task 3）。

- [ ] 深色头部：`bg-[radial-gradient(140%_120%_at_85%_-20%,#4a1218_0%,#1a1214_55%)]` 圆角下边、品牌「东方文澜」+ 副标、右上金色（#ffc53d）积分数（/api/credits）
- [ ] Banner 轮播：无 banner 时整块不渲染；多条时 5s 自动切 + 圆点；linkUrl 有值整卡可点（站内 Link / 外链 a）
- [ ] 双 CTA、工具宫格（真实工具填格，`4 - tools.length % 4` 补「敬请期待」灰格；0 个工具显示「更多工具开发中」整块占位）、最近成片横滑（VideoCard 窄版 flex 0 0 128px）
- [ ] 底导航中央凸起钮样式照样稿（-mt-6、52px 圆、grad、shadow）；激活态 flame 色
- [ ] 提交

### Task 5: 框架库 + 工具四页 restyle（含防错）

**Files:**
- Modify: `web/app/(student)/templates/page.tsx`、`tools/page.tsx`、`tools/[id]/page.tsx`、`tools/runs/page.tsx`、`tools/runs/[id]/page.tsx`

- [ ] 框架库：卡片行式（左 56px 9:16 渐变缩略占位 + 框架名 + 段数/时长副行 + 右侧「去做片」），选中出题流程逻辑不动
- [ ] 工具广场：卡片行（首字衬线大字图标 + 名称 + 描述 + 右侧「N 积分/次」），顶部副标「按次计费 · 失败自动退」，底部「运行记录 →」
- [ ] 工具表单：每字段 label 加必填星标（红 `*`）与说明 small；图片字段虚线上传框（内联 SVG 图标）；提交按钮写明「消耗 N 积分 · 开始生成」；服务端 400 报错若含字段名则把错误文案挂到对应字段下方（按 label 匹配），匹配不到才顶部红条
- [ ] 结果页：video 项用 VideoCard；文本项复制按钮；「再跑一次」带原输入跳回表单（query 传 runId，表单页读该 run 的 inputs 预填——GET /api/tools/runs/[id] 已返回 inputs）
- [ ] 记录页：状态点（ok 绿/run 红脉冲/bad 深红）+ 失败行显示「已退 N 积分」
- [ ] 提交

### Task 6: 后台生成列表卡片网格

**Files:**
- Modify: `web/app/admin/generate/page.tsx`

- [ ] 行表改 `grid-cols-[repeat(auto-fill,minmax(200px,1fr))]` 卡片：VideoCard + footer 操作（工作台 Link/下载/重跑，沿用现有 handler），副行学员手机号打码 `138****2210` 格式 + 相对时间；现有筛选/分页逻辑保留
- [ ] 提交

### Task 7: 扣子 probe-params

**Files:**
- Create: `packages/db/src/ai/cozeProbe.ts` + `cozeProbe.test.ts`
- Create: `web/app/api/admin/coze-tools/probe-params/route.ts`
- Modify: `web/app/admin/coze-tools/page.tsx`（编辑器加「自动探测」按钮）

**Interfaces:**
- Produces: `cozeProbeWorkflowParams(workflowId, opts?: {fetchImpl?, maxRounds?}) => Promise<{ fields: {name:string; type:'text'|'image'; required:true}[]; started: boolean }>`
- 循环逻辑（实测行为，2026-09-03 spike）：POST `${baseUrl}/v1/workflow/stream_run`，body `{workflow_id, parameters}`；读响应文本首个 `data: {...}` 行 JSON：
  - `error_message` 以 `Missing parameter: ` 开头 → 记该字段 `{type:'text'}`，参数表补 `"探测"` 继续
  - `error_message` 含 `can't convert to file` → 最近补的字段改 `{type:'image'}`，参数值换 `JSON.stringify({file_id:'0'})` 继续（file_id 无效没关系，类型校验在前）
  - 其它/无错误事件 → 收敛，`started=true`（工作流真的启动了）
  - 上限 `maxRounds`（默认 12）未收敛 → 返回已探到的字段，`started=false`
- 路由：requireRole ADMIN，校验 workflowId 数字串，响应 `{ fields, warning?: string }`（started 时 warning='探测已真实启动一次该工作流，请到扣子后台确认无副作用'）
- 管理页：按钮点击调接口，返回字段合并进 inputs 编辑器（同名跳过），image→图片类型、text→单行文本，label 默认=name

- [ ] cozeProbe 测试：三轮收敛（missing→missing→file→跑通）、上限不收敛、鉴权失败抛错（fetchImpl 注入伪流式文本）
- [ ] 提交

### Task 8: 最终全分支评审

- [ ] 全量测试 + `npx tsc --noEmit -p web`（基线 45）/`-p worker`（0）
- [ ] 派发最终代码评审（最强模型），一轮修复波 + 范围内复审
- [ ] 手机宽度（390px）用浏览器实测首页/成片库/工具表单无横向滚动
