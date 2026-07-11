# 东方文澜 · 服务器部署指南（Ubuntu 26.04 64 位）

整套服务用 Docker Compose 运行：Next.js 前端/接口、后台混剪 Worker、PostgreSQL、Redis，外加 Caddy 反向代理并自动签发 HTTPS 证书。你只需在服务器上执行几条命令。

---

## 准备：一个域名
把域名的 **A 记录**解析到服务器公网 IP（例如 `app.example.com → 1.2.3.4`）。证书签发依赖这一步，务必先解析生效。

---

## 第 1 步：在服务器安装 Docker

SSH 登录服务器后执行：

```bash
# 安装 Docker 与 compose 插件（官方脚本）
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker "$USER"   # 让当前用户免 sudo 使用 docker
newgrp docker                     # 立即生效（或重新登录）

# 验证
docker version
docker compose version
```

## 第 2 步：放行防火墙 80 / 443

```bash
sudo ufw allow 22/tcp
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw --force enable   # 如已启用可跳过
```
> 云服务器还需在厂商控制台的「安全组」放行 80、443（和用于 SSH 的 22）。

## 第 3 步：上传项目代码（tarball）

在**你本机**（项目目录）把代码打包上传：

```bash
# 本机执行：scp 上传（把 IP/用户名换成你的）
scp dongfangwenlan.tar.gz ubuntu@1.2.3.4:~/
```

在**服务器**解压：

```bash
mkdir -p ~/dongfangwenlan && tar -xzf ~/dongfangwenlan.tar.gz -C ~/dongfangwenlan
cd ~/dongfangwenlan
```

## 第 4 步：一键部署

```bash
bash deploy/deploy.sh
```

脚本会：
1. 检查 Docker；
2. 交互询问 **域名 / 证书邮箱 / 管理员邮箱 / 管理员密码**，自动生成随机 `JWT_SECRET` 和数据库密码，写入 `.env.prod`（权限 600）；
3. 构建镜像并启动全部服务；
4. 自动执行数据库迁移 + 初始化管理员和标签树；
5. 打印状态。首次构建较慢（要装 ffmpeg、编译前端），请耐心等待。

> 想手动控制，也可先 `cp .env.prod.example .env.prod` 自行填写，再执行
> `docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --build`。

## 第 5 步：验证

- 等 Caddy 签发证书（约几十秒），浏览器访问 `https://你的域名`。
- 用 `.env.prod` 里的 `ADMIN_EMAIL` / `ADMIN_PASSWORD` 登录，进入 PC 管理后台。
- 到后台「SMTP 设置」填写邮件服务并开启——学员注册的邮箱验证码依赖它。

---

## 日常运维

```bash
cd ~/dongfangwenlan
C="docker compose -f docker-compose.prod.yml --env-file .env.prod"

$C ps                 # 查看状态
$C logs -f web worker # 看日志
$C restart web        # 重启某服务
$C down               # 停止（数据保留在卷里）
```

### 更新到新版本
```bash
# 上传新 tarball 覆盖解压后：
cd ~/dongfangwenlan
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --build
# migrate 服务会自动应用新增数据库迁移
```

### 数据备份
- 数据库：`docker compose -f docker-compose.prod.yml --env-file .env.prod exec postgres pg_dump -U mixcut mixcut > backup_$(date +%F).sql`
- 素材与成片：备份项目下的 `data/` 目录。

---

## 说明与安全

- **不含演示账号**：生产默认只创建你指定的管理员。若想体验演示数据，部署时对「写入演示数据」选 `y`（或 `.env.prod` 里 `SEED_DEMO=1`）。
- **端口暴露**：仅 Caddy 对外开放 80/443；数据库、Redis、前端 3000 都只在内网，不暴露公网。
- **密钥**：`.env.prod` 含明文密钥，权限 600，勿提交到 git、勿外泄。
- **管理员密码**：`bootstrap` 只在首次创建管理员，之后不会用 `.env.prod` 覆盖已有密码。
