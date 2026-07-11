#!/usr/bin/env bash
# 东方文澜 · 一键部署脚本（在服务器项目根目录执行：bash deploy/deploy.sh）
set -euo pipefail

cd "$(dirname "$0")/.."
ROOT="$(pwd)"
ENV_FILE="$ROOT/.env.prod"
COMPOSE="docker compose -f docker-compose.prod.yml --env-file .env.prod"

echo "==> 项目根目录：$ROOT"

# 1. 检查 Docker
if ! command -v docker >/dev/null 2>&1; then
  echo "!! 未检测到 docker，请先安装（见 deploy/README.md 第 1 步）"; exit 1
fi
if ! docker compose version >/dev/null 2>&1; then
  echo "!! 未检测到 docker compose 插件，请先安装（见 deploy/README.md 第 1 步）"; exit 1
fi

# 2. 生成 .env.prod（若不存在则交互生成，并自动填入随机密钥）
if [ ! -f "$ENV_FILE" ]; then
  echo "==> 未找到 .env.prod，开始交互式生成"
  read -rp "  访问域名 DOMAIN（如 app.example.com）: " DOMAIN
  read -rp "  证书邮箱 ACME_EMAIL: " ACME_EMAIL
  read -rp "  管理员邮箱 ADMIN_EMAIL: " ADMIN_EMAIL
  read -rsp "  管理员密码 ADMIN_PASSWORD: " ADMIN_PASSWORD; echo
  read -rp "  是否写入演示数据？(y/N): " SEED_ANS
  SEED_DEMO=""; [ "${SEED_ANS:-N}" = "y" ] || [ "${SEED_ANS:-N}" = "Y" ] && SEED_DEMO=1

  JWT_SECRET="$(openssl rand -hex 32)"
  POSTGRES_PASSWORD="$(openssl rand -hex 16)"

  cat > "$ENV_FILE" <<EOF
DOMAIN=$DOMAIN
ACME_EMAIL=$ACME_EMAIL
ADMIN_EMAIL=$ADMIN_EMAIL
ADMIN_PASSWORD=$ADMIN_PASSWORD
ADMIN_NICKNAME=管理员
POSTGRES_USER=mixcut
POSTGRES_PASSWORD=$POSTGRES_PASSWORD
POSTGRES_DB=mixcut
DATABASE_URL=postgresql://mixcut:$POSTGRES_PASSWORD@postgres:5432/mixcut
REDIS_HOST=redis
REDIS_PORT=6379
JWT_SECRET=$JWT_SECRET
DATA_DIR=/data
SEED_DEMO=$SEED_DEMO
EOF
  chmod 600 "$ENV_FILE"
  echo "==> 已生成 .env.prod（权限 600，密钥已随机生成）"
else
  echo "==> 已存在 .env.prod，直接使用"
fi

# 3. 构建并启动
echo "==> 构建镜像并启动（首次会拉取/编译，耗时较久）"
$COMPOSE up -d --build

# 4. 等待迁移任务完成
echo "==> 等待数据库迁移与初始化 ..."
$COMPOSE logs -f migrate || true

echo
echo "==> 当前服务状态："
$COMPOSE ps
echo
DOMAIN_SHOW="$(grep '^DOMAIN=' "$ENV_FILE" | cut -d= -f2-)"
echo "✅ 部署完成。稍等证书签发后访问：https://$DOMAIN_SHOW"
echo "   管理员登录邮箱见 .env.prod 中的 ADMIN_EMAIL"
echo "   查看日志：  $COMPOSE logs -f web worker"
echo "   停止服务：  $COMPOSE down"
