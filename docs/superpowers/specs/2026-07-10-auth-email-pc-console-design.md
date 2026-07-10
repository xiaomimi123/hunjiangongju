# 邮箱注册 + SMTP 邮件基础设施 + PC 管理控制台 —— 设计文档

日期：2026-07-10
上游：本项目现有 MVP（`docs/superpowers/specs/2026-07-09-mixcut-mvp-design.md`），当前 `main` 已含移动端「带货工作台」重设计。

## 1. 目标

三件事，一次做完：

1. **移动端登录页改造**：去掉「密钥登录」，改为「登录 / 注册」，学员用**邮箱 + 密码**自助注册。
2. **SMTP 邮件基础设施**：管理后台可配置 SMTP 并可开启/关闭；用于**注册邮箱验证**与**忘记密码找回**。
3. **PC 桌面管理控制台**：把现有移动端「运营后台」改成桌面宽屏布局；运营人员与管理员共用同一入口；新增「注册学员数据」页（统计看板 + 数据表）。

## 2. 架构

**同一个 Next 应用，按角色分两套界面**（沿用现有结构，改动最小）：

- 移动端学员界面：现有 `web/app/(student)/*`（移动优先），本次仅改登录页。
- PC 桌面控制台：`web/app/admin/*` 改为桌面宽屏（左侧固定侧边栏 + 顶栏 + 宽内容区）。
- 登录后按角色跳转：`student → /`（移动首页），`operator → /admin/students`（控制台首页）。
- 「运营人员」与「后台管理员」统一为 **operator 角色 / 一个控制台**，不区分子角色。

不引入第二个前端工程、不做整站响应式合并——学员端与管理端本就是两种界面。

## 3. 数据模型变更（Prisma）

### 3.1 `User`（改）
- 新增 `email String @unique @map("email")` —— 唯一账号标识，登录用。
- 新增 `nickname String? @map("nickname")` —— 注册填写的昵称。
- 保留 `account`（改为可空 `String?`，不再唯一约束，历史兼容）；`passwordHash` / `role` / `createdAt` 不变。
- `role` 取值仍为 `student` / `operator`；自助注册强制 `student`。

### 3.2 `SmtpConfig`（新，单条）
```
model SmtpConfig {
  id           Int      @id @default(1)      // 固定单行
  host         String   @default("")
  port         Int      @default(465)
  secure       Boolean  @default(true)       // true=SSL(465) / false=STARTTLS(587)
  username     String   @default("")
  passwordEnc  String   @default("")         // AES 加密存储，见 §6.3
  fromAddress  String   @default("")
  fromName     String   @default("投流工作台")
  enabled      Boolean  @default(false)       // 总开关
  updatedAt    DateTime @updatedAt @map("updated_at")
  @@map("smtp_config")
}
```

### 3.3 `EmailCode`（新）
```
model EmailCode {
  id         String    @id @default(uuid())
  email      String
  codeHash   String    @map("code_hash")     // 6 位数字码的 bcrypt/sha256，不存明文
  purpose    String                          // 'verify' | 'reset'
  expiresAt  DateTime  @map("expires_at")     // now + 10min
  consumedAt DateTime? @map("consumed_at")
  createdAt  DateTime  @default(now()) @map("created_at")
  @@index([email, purpose])
  @@map("email_codes")
}
```

生成一条新码时，先把该 `email + purpose` 下未消费的旧码作废（`consumedAt` 置为 now 或删除），避免多码并存。

## 4. 认证流程

### 4.1 公开配置探测
- `GET /api/auth/config` → `{ emailEnabled: boolean }`（读 `SmtpConfig.enabled && host` 非空）。
- 登录页据此决定：是否显示「验证码」步骤、是否显示「忘记密码」入口。此接口无需登录。

### 4.2 注册
- `POST /api/auth/register` body `{ email, password, nickname }`。
  - 校验：邮箱格式、密码长度 ≥ 6、昵称非空；邮箱未被占用（否则 409）。
  - **SMTP 关**：直接 `bcrypt` 建 `User(role=student)`，签发 JWT cookie，返回 `{ role, needsVerification: false }`。
  - **SMTP 开**：**不建号**，生成 `EmailCode(purpose=verify)`，发验证码邮件，返回 `{ needsVerification: true }`。密码需在验证步骤重传，或临时缓存——见下。
- `POST /api/auth/verify-email` body `{ email, code, password, nickname }`（SMTP 开时的第二步）。
  - 校验最近未过期未消费的 `verify` 码匹配 → 消费该码 → 建 `User(role=student)` → 签发 JWT cookie → 返回 `{ role }`。
  - 采用「第二步重传 password/nickname」的无状态做法，避免服务端缓存半成品账号。

### 4.3 登录
- `POST /api/auth/login` body `{ email, password }` → 按 `email` 查 `User`，`bcrypt.compare`，签发 JWT cookie，返回 `{ role }`。
- 去掉原「密钥登录」分支；`AccessKey` 表保留但不再使用。

### 4.4 忘记密码（仅 SMTP 开时可用）
- `POST /api/auth/forgot` body `{ email }` → 若邮箱存在则生成 `EmailCode(purpose=reset)` 发邮件；**无论是否存在都返回 200**（不暴露账号是否注册）。
- `POST /api/auth/reset` body `{ email, code, newPassword }` → 校验 reset 码 → 消费 → 更新 `passwordHash`。SMTP 关时该两接口返回 400「未开启邮件服务」。

### 4.5 登出
- `POST /api/auth/logout` 不变。

## 5. 移动端登录页（`web/app/(auth)/login/page.tsx`）

- 顶部品牌不变；主体两个 tab：**登录 / 注册**。
- 登录 tab：邮箱、密码、`emailEnabled` 时显示「忘记密码」链接（弹出邮箱→发码→输码+新密码）。
- 注册 tab：邮箱、密码、昵称；`emailEnabled` 时提交后进入「输入验证码」态（同页切换），再提交完成。
- 全部沿用现有设计系统（`.field` / `.btn-primary` / `pill pill-bad` 等），移动优先。
- 逻辑：先 `GET /api/auth/config`，据 `emailEnabled` 渲染。

## 6. SMTP 邮件基础设施

### 6.1 依赖
- 新增 `nodemailer`（web 侧发信）。

### 6.2 发信模块 `web/lib/mailer.ts`
- `getSmtp()`：读 `SmtpConfig`（解密密码）。
- `sendMail(to, subject, text/html)`：按配置建 transporter 发信；未启用/未配置则抛 `HttpError(400,'未开启邮件服务')`。
- `sendCode(to, purpose)`：生成 6 位码、写 `EmailCode`、发对应模板邮件。
- 中文邮件模板：验证码 / 重置码。

### 6.3 密码加密存储
- `SmtpConfig.passwordEnc` 用 AES-256-GCM 加密，密钥由 `process.env.JWT_SECRET` 派生（`scrypt`）。`web/lib/crypto.ts` 提供 `encrypt/decrypt`。
- API 返回配置时**不回传明文密码**（只回传「已设置」布尔位）；PUT 时密码为空表示不修改。

### 6.4 管理 API（仅 operator）
- `GET /api/admin/smtp` → 配置（密码脱敏）。
- `PUT /api/admin/smtp` → 保存配置（含 `enabled`）。
- `POST /api/admin/smtp/test` body `{ to }` → 用当前（或表单提交的）配置发一封测试邮件，返回成功/错误信息。

### 6.5 设置页 `/admin/settings`
- 表单：host / port / secure(TLS-SSL 选择) / username / password / fromAddress / fromName / enabled 开关。
- 「发送测试邮件」按钮（输入收件邮箱）。
- 保存后即时生效（下次发信读最新配置）。

## 7. PC 桌面控制台

### 7.1 布局 `web/app/admin/layout.tsx`（重做为桌面）
- 左侧固定侧边栏导航：**学员数据 / 标签 / 素材 / 文案 / 任务 / 设置**（当前项高亮，火焰渐变）。
- 顶栏：品牌 + 当前运营账号 + 退出。
- 内容区宽屏（`max-w` 放大到桌面宽度，如 `max-w-6xl`，多列/宽表格）。
- 窄屏（<768px）降级为可用布局（侧边栏收起为顶部或抽屉），但**主目标是 PC**。
- 复用现有设计系统 token；新增少量桌面用类（侧边栏项、数据表 `.table` 等）。

### 7.2 现有四页改桌面版
- `/admin/tags`、`/admin/materials`、`/admin/scripts`(+`[id]`)、`/admin/tasks`(+`[id]`)：从移动卡片布局改为桌面宽表格/多列布局，逻辑不变，仅表现层 + 容器宽度。

### 7.3 学员数据页 `/admin/students`（控制台首页）
- 统计看板卡片：总学员数 / 今日新增 / 总任务数 / 导出成片数。
- 数据表：邮箱 / 昵称 / 注册时间 / 任务总数 / 已完成数；搜索框（按邮箱/昵称）+ 分页。
- 只读（本期不做禁用/删除）。
- API：`GET /api/admin/students?search=&page=&pageSize=` → `{ stats:{...}, students:[...], total }`（仅 operator）。

## 8. 种子数据（`worker/src/seed.ts` 更新）
- 运营账号：`email=operator@demo.com` / `op123456` / nickname「运营小队」。
- 若干示例学员：`student1@demo.com … student3@demo.com` / `stu123456` / 昵称，让数据页有内容。
- 去掉 access key 相关种子。
- SmtpConfig 默认单行 `enabled=false`（不配真实 SMTP，注册即用；管理员日后自行配置）。

## 9. 中间件与路由
- `web/middleware.ts`：`/api/auth/*` 与登录页放行不变；`/admin/*` 仍要 operator。`/fonts` 静态放行保持。
- operator 登录跳 `/admin/students`；student 登录跳 `/`。

## 10. 测试
- 单元（host vitest，纯函数）：邮箱格式校验、6 位码生成/校验（哈希+过期+消费）、AES 加解密 round-trip。
- 集成（容器 curl）：注册（开/关 SMTP 两条路径）、登录、忘密（开 SMTP）、`/api/admin/students` 统计与分页、`/api/admin/smtp` 存取与脱敏。SMTP 实际发信用一个可捕获的假 transporter 或指向本地捕获邮箱验证（见实施计划）。

## 11. 范围边界（本期不做）
- 邮箱验证链接（只做 6 位数字码）。
- 后台「新建运营/管理员」界面（运营账号走种子）。
- 学员禁用/删除、学员作品钻取（数据页只读）。
- 短信、第三方登录、限流/风控（登录/发码可加简单频率限制作为可选加固，非必需）。
- 移动端学员其余页面（首页/作品/详情）不改。

## 12. 关键决策记录
- 邮箱作唯一账号；`account` 降级为可空兼容字段。
- SMTP 总开关同时决定「注册是否需验证」「忘密是否可用」——与用户「可开启关闭」诉求一致。
- 验证/重置码：6 位数字、10 分钟、哈希存储、一次性消费、同邮箱同用途旧码作废。
- SMTP 密码 AES-GCM 加密存储，密钥派生自 `JWT_SECRET`；接口不回明文。
