# 东方文澜 · 电商带货短视频混剪工具

面向电商带货场景的短视频「一键混剪」平台。学员选择文案模版，系统自动完成脚本分段、素材匹配、渲染、字幕与质检，产出可直接投流的竖屏 / 横屏成片。

线上地址：https://www.dfwl.top

## 功能概览

**学员端（移动端 Web，4-Tab）**
- 邮箱注册（验证码）/ 登录 / 忘记密码找回
- 首页、模版库（选文案包一键生成，竖屏 9:16 / 横屏 16:9）
- 工具广场：从扣子工作流工具库选工具、填表单、运行获取结果（文本/图片/视频），支持图片上传、结果可复制/下载、查看运行记录
- 作品列表与详情：生产线进度（分段→匹配→渲染→质检→导出）、预览确认、下载成片 MP4 / 字幕 SRT / 项目 JSON
- 我的：自助修改密码、退出登录

**管理员端（PC 管理后台）**
- 学员数据管理：统计看板、搜索、查看作品、重置密码、禁用/启用登录、删除
- 积分体系：1 条视频 = 1 积分，新账号送 30 分；用完时学员端弹导师收款二维码（后台「系统设置」上传），导师线下收款后在「学员数据」给学员充值（带充值流水）
- 扣子工具箱：导入扣子工作流、配中文标签/输入类型/价格、上下架、查看学员运行记录；全站一个扣子 PAT Token 在「模型配置」配置
- 标签树、素材（上传+打标签）、文案（分段+打标签+发布）、任务监控
- 素材库：批量上传图片/视频素材、按文件夹分类管理；生成配图时可选「素材库优先」，按分镜顺序复用素材，不够的分镜自动回退 AI 生图
- 剪映工程导入：直接选整个剪映工程文件夹一键导入（自动找 draft_content.json；BGM/图片素材自动入库并按工程名分文件夹；生成时自动用原 BGM 与素材）；也支持新版加密工程，自动回退解析明文时间线（`Timelines/*/template.json`），并额外提取调色、逐段运镜、字幕入场动画与画面基础缩放
- 剪辑参数：框架级与单条级两个工作台共用同一套控件，可调节奏、转场、运镜、字幕样式、文字层、配乐、文案口径。**中英双语字幕**可按框架开关，开启后中文在上、英文紧贴其下，英文字号倍数 / 颜色 / 行间距独立可调；关闭的框架在生成时会跳过翻译调用
- 剪辑参数页带**所见即所得画布**：按真实分辨率等比缩放，可切「开场 / 快闪卡 / 正片」三个场景与「占位图 / 亮底 / 暗底 / 自传图」四种底图（自传图仅本地预览、不上传服务器），文字层可直接拖动改竖直位置、拖把手改字号，改完的数值即是存进参数的数值。画布与成片共用同一份字体文件与同一套长标题缩排逻辑，但仍是示意预览，最终以成片为准
- 字体管理（`/admin/settings/fonts`）：内置 5 款可商用中文字体（思源黑体常规/加粗、思源宋体、霞鹜文楷、站酷快乐体），运营也可上传自有 `.ttf` / `.otf`（上传时自动解析字体内部族名与字重，解析失败即拒收，不接受手填）。剪辑参数里正文字幕与标题类字体可分别选择，开启中英双语后英文行可另选字体
- 邮件服务（SMTP）配置、后台账号自助改密

**AI 选书**：学员生成时只需填一个「选题」（书名或主题），系统自动配齐模板需要的完整书单——先联网查证学员输入是否真实存在的书，再补齐同主题的其余书目并逐条二次校验，学员那本始终排第一且每次生成的书单组合、文案切入角度都不同（同一选题不同任务不会撞车）。查证通过的书目会沉淀进书库长期复用；书库由运营在后台 `/admin/books` 维护（列表、按主题筛选、增删改），用于纠正 AI 偶尔的编造。

**图片加载**：生成图、素材库图片落盘时会同时产出一张 360px 宽的 `.thumb.webp` 缩略图，任务详情页/编辑页分镜网格、素材库网格都优先加载缩略图（体积约为原图的 1/10~1/30），点开看大图仍用原图；缩略图缺失或加载失败时前端自动回退原图，仅重试一次。`/api/files/*` 接口带 `ETag`/`Last-Modified` 校验，同一张图未变化时浏览器只收到 `304`（不重下）。**部署这次更新前生成的旧任务没有缩略图文件属预期**，会自动回退展示原图，无需补跑或迁移。

## 技术栈

- **前端/接口**：Next.js 14（App Router）、TypeScript、Tailwind CSS
- **数据**：Prisma 5 + PostgreSQL 16
- **队列/异步**：BullMQ 5 + Redis 7
- **视频**：fluent-ffmpeg（ffmpeg + Noto CJK 字体）
- **认证**：JWT（httpOnly Cookie，生产环境额外带 Secure）+ bcrypt；邮箱验证码（nodemailer）。鉴权在服务端回查数据库比对账号禁用状态与「会话代次」（`sessionEpoch`），改密码 / 重置密码会使该账号此前签发的登录状态立即失效，禁用账号会让其后续 API 调用立即 401
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

多数用例是纯函数、不需要外部依赖；但 `renderState` / `ai` / `voiceClone` / `generateScript`
等用例会真连数据库（读能力配置、写状态日志），**没有库时这几个会失败**。跑全量前先起一个测试库：

```bash
# 1) 起库（dev override 已把 postgres 暴露到宿主机 55433）
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d postgres

# 2) 建一个独立的测试库并应用迁移（与开发库 mixcut 隔离，测试用例会写数据）
docker compose exec postgres psql -U mixcut -d postgres -c "CREATE DATABASE mixcut_test OWNER mixcut;"
DATABASE_URL="postgresql://mixcut:mixcut@127.0.0.1:55433/mixcut_test" \
  npx prisma migrate deploy --schema packages/db/prisma/schema.prisma

# 3) 跑全量
npm install
DATABASE_URL="postgresql://mixcut:mixcut@127.0.0.1:55433/mixcut_test" npx vitest run
```

只跑纯函数用例（不需要库）：`npx vitest run worker packages/db/src/captions.test.ts` 之类按路径挑选即可。

> 用 `mixcut_test` 而非开发库 `mixcut`：测试会真实写入表数据；且长期使用的开发库容易与迁移记录
> 产生漂移（曾出现列已存在但迁移未登记，导致 `migrate deploy` 报 P3018）。测试库随时可删重建。

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
