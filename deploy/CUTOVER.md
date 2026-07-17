# 切换上线 Runbook —— 东方文澜 v1 混剪 → v2.2 拆解生成

> 把线上正在运行的**旧混剪产品**切换为**新 v2.2「爆款视频拆解 + AI 生成」产品**。
> **保留学员账号（users 表），删除旧混剪内容（素材/标签/文案/混剪任务等表）。** 品牌沿用「东方文澜」。
> 服务器：阿里云 `101.37.151.152`，域名 `www.dfwl.top`，部署栈见 `deploy/README.md`。

---

## ⚠️ 这次切换会发生什么

- **保留**：`users` 表（全部学员/运营账号与登录密码）、SMTP 配置、邮箱验证码表、AI 模型配置表。学员**无需重新注册**，原账号密码可继续登录。
- **删除（不可恢复）**：旧混剪的 `materials / material_tags / tag_categories / segment_tags / scripts / script_segments / tasks / task_segments / task_status_logs / qc_reports / access_keys / exports` 表及其数据（旧上传的实拍素材、旧文案、旧混剪任务与成片记录）。
- **新增**：v2.2 全部新表（拆解源视频、转写、场景、框架、生成任务、渲染任务、BGM 等）。
- 上述由 `prisma migrate deploy` 在部署时**自动**完成（新产品首次部署会按顺序跑 P0→P3 全部迁移：先建新表，最后 `drop_legacy_mixcut` 删旧表）。

> 因为线上此前一直是旧产品（P0–P3 从未部署），首次部署新 tarball 时会一次性应用全部 v2.2 迁移。学员账号所在的 `users` 表不在删除清单，登录不受影响。

---

## 第 0 步：先备份线上数据库（务必！）

在服务器执行（切换前必做，删表不可逆）：
```bash
cd ~/dongfangwenlan
C="docker compose -f docker-compose.prod.yml --env-file .env.prod"
$C exec -T postgres pg_dump -U mixcut mixcut > ~/backup_before_v2.2_$(date +%F_%H%M).sql
ls -lh ~/backup_before_v2.2_*.sql   # 确认备份文件已生成且非空
```
> 万一切换后要回滚：停栈 → 用此 sql 恢复旧库 → 部署旧代码。备份是唯一后悔药。

## 第 1 步：本机上传新代码包

```bash
# 本机（项目根目录）
cd /Users/lizhishaoniange/Documents/电商带货混剪工具
git archive --format=tar.gz -o dongfangwenlan.tar.gz HEAD
scp dongfangwenlan.tar.gz root@101.37.151.152:~/
```

## 第 2 步：服务器解压覆盖（保留 .env.prod 与 data/）

```bash
cd ~/dongfangwenlan
tar -xzf ~/dongfangwenlan.tar.gz -C ~/dongfangwenlan
```

## 第 3 步：构建并启动（自动跑迁移：建新表 + 删旧混剪表，保留 users）

```bash
C="docker compose -f docker-compose.prod.yml --env-file .env.prod"
$C up -d --build
```
> worker 镜像会装 ffmpeg + Noto CJK 字体 + **chromium**（HyperFrames 渲染依赖），首次构建较久。

## 第 4 步：确认迁移与初始化

```bash
$C logs migrate | tail -30
```
应看到全部迁移 `applied`（含 `..._p3_drop_legacy_mixcut`）+ `[bootstrap] 完成`。若报错先停在这一步排查，别继续。

验证保留/删除是否正确：
```bash
$C exec -T postgres psql -U mixcut -d mixcut -c "SELECT count(*) AS 学员数 FROM users WHERE role='student';"
$C exec -T postgres psql -U mixcut -d mixcut -c "SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename IN ('materials','scripts','tasks','access_keys');"   -- 应为空（旧表已删）
$C exec -T postgres psql -U mixcut -d mixcut -c "SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename IN ('source_videos','generation_tasks','render_tasks');"   -- 应列出 3 张（v2.2 新表在）
```

## 第 5 步：功能验证（浏览器）

1. 打开 `https://www.dfwl.top` → 用**原有学员账号**登录，应成功进入**新学员端**（首页 / 框架库 / 成片库 / 我的）。
2. 用运营账号 `admin` 登录后台 → 侧栏为 概览 / 拆解 / 生成 / 运营 / 系统（无旧「素材·文案·标签」）；仪表盘显示生成/拆解统计。
3. 运营：`/admin/extract` 上传一条视频拆解 → 产出框架 → `/admin/frameworks` 发布；`/admin/generate` 选框架生成一条成片 → EXPORTED → 可发布到成片库。
4. 学员：框架库选已发布框架 + 填选题 → 生成（自动出片）→「我的作品」下载；成片库能看到运营发布的成片。

## 第 6 步：接入真实 AI 能力（出真素材）

到后台 **系统 → 模型配置**（`/admin/models`），为 **LLM 文案 / 文生图 / TTS 配音 / ASR 转写** 各填接口地址 + 密钥 + 模型（aitoken.homes relay，OpenAI 兼容格式），点「测试连通」通过后**启用**。
> 未启用时全链路走内置 mock（占位画面/静音），仅供跑通流程；启用后才产出真实画面与配音。

---

## 回滚（万一切换后严重异常）

```bash
cd ~/dongfangwenlan
C="docker compose -f docker-compose.prod.yml --env-file .env.prod"
$C down
# 恢复旧库
$C up -d postgres && sleep 8
cat ~/backup_before_v2.2_*.sql | $C exec -T postgres psql -U mixcut -d mixcut
# 部署回旧代码（旧 tarball / 旧 git 版本）后再 up -d --build
```
> 注意：新产品已生成的 v2.2 数据在回滚恢复旧库时会丢失（回到备份时点）。仅在切换后立即发现问题时使用。

## 常见问题

- **学员登录说账号不存在？** 检查第 4 步 `users` 学员数是否 > 0；`users` 表不在删除清单，理论上保留。若为 0，说明误删——用第 0 步备份恢复。
- **构建卡在拉包？** 见 `deploy/README.md` 的国内镜像源配置（apt 阿里云 / npm npmmirror）；worker Dockerfile 已内置。
- **生成一直 mock（画面是色块）？** 未在模型配置页启用真实 AI 能力（第 6 步）。
