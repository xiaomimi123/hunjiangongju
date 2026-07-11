# 东方文澜 · 电商带货短视频混剪工具

面向电商带货场景的短视频「一键混剪」平台。学员选择文案模版，系统自动完成脚本分段、素材匹配、渲染、字幕与质检，产出可直接投流的竖屏 / 横屏成片。

线上地址：https://www.dfwl.top

## 功能概览

**学员端（移动端 Web，4-Tab）**
- 邮箱注册（验证码）/ 登录 / 忘记密码找回
- 首页、模版库（选文案包一键生成，竖屏 9:16 / 横屏 16:9）
- 作品列表与详情：生产线进度（分段→匹配→渲染→质检→导出）、预览确认、下载成片 MP4 / 字幕 SRT / 项目 JSON
- 我的：自助修改密码、退出登录

**管理员端（PC 管理后台）**
- 学员数据管理：统计看板、搜索、查看作品、重置密码、禁用/启用登录、删除
- 标签树、素材（上传+打标签）、文案（分段+打标签+发布）、任务监控
- 邮件服务（SMTP）配置、后台账号自助改密

## 技术栈

- **前端/接口**：Next.js 14（App Router）、TypeScript、Tailwind CSS
- **数据**：Prisma 5 + PostgreSQL 16
- **队列/异步**：BullMQ 5 + Redis 7
- **视频**：fluent-ffmpeg（ffmpeg + Noto CJK 字体）
- **认证**：JWT（httpOnly Cookie）+ bcrypt；邮箱验证码（nodemailer）
- **部署**：Docker Compose + Caddy（自动 HTTPS）

## 项目结构（monorepo）

```
packages/db     Prisma schema、迁移、DB 客户端、混剪流水线核心
web             Next.js 前端与 API 路由（学员端 + 管理后台）
worker          BullMQ Worker（分段/匹配/渲染/质检）+ seed / bootstrap 脚本
deploy          生产部署脚本、Caddyfile、部署文档
```

## 本地开发

```bash
cp .env.example .env
mkdir -p data/materials data/exports
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d --build

# 首次：应用迁移 + 写入演示数据（演示学员/素材/文案）
docker compose -f docker-compose.yml -f docker-compose.dev.yml exec web npx prisma migrate deploy --schema packages/db/prisma/schema.prisma
docker compose -f docker-compose.yml -f docker-compose.dev.yml exec worker npm run seed
```

访问 http://localhost:3000

**开发环境演示账号（由 seed 写入，仅本地）**

| 角色 | 登录邮箱 | 密码 |
|---|---|---|
| 运营 | operator@demo.com | op123456 |
| 学员 | student1@demo.com（含 2 / 3） | stu123456 |

> 登录方式为「邮箱 + 密码」；早期的密钥登录已移除。

## 测试

```bash
npm install && npx vitest run
```

## 生产部署

生产使用独立的 `docker-compose.prod.yml`：PostgreSQL / Redis / web / worker + Caddy（自动签发 Let's Encrypt 证书），仅 Caddy 对外开放 80/443，其余内网隔离。启动时一次性 `migrate` 服务自动应用迁移并初始化管理员。

**不含演示账号**：生产只按环境变量创建一个管理员，学员自助注册。

一键部署（在服务器项目根目录）：

```bash
bash deploy/deploy.sh
```

脚本会交互生成 `.env.prod`（自动填入随机 `JWT_SECRET` 与数据库密码），构建并启动全部服务。完整步骤（含 Ubuntu 安装 Docker、防火墙、域名解析、更新与备份）见 **[deploy/README.md](deploy/README.md)**。

手动方式：

```bash
cp .env.prod.example .env.prod   # 按需填写域名 / 管理员 / 邮箱
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --build
```

## 运维须知

- **`JWT_SECRET` 不可随意轮换**：SMTP 密码用派生自 `JWT_SECRET` 的密钥加密存储，轮换后已存的 SMTP 密码将无法解密（需在后台重填），且所有登录 Cookie 失效。
- **管理员账号**：生产管理员账号来自 `.env.prod` 的 `ADMIN_EMAIL`（当前线上为 `admin`）。`bootstrap` 只在首次创建，不会用环境变量覆盖已有密码；登录后可在后台「账号」页自助改密。
- **数据持久化**：数据库在 Docker 卷中，上传素材与成片在项目 `data/` 目录，备份见 deploy/README.md。
- **国内服务器构建**：`web` / `worker` 的 Dockerfile 已内置阿里云 apt 源、npmmirror 与 prisma 引擎镜像，避免 `deb.debian.org` 超时。
