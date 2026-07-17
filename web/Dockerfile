FROM node:20-bookworm-slim AS base
# CN=1（默认，国内服务器）：apt 换阿里云源、npm 换 npmmirror、prisma 引擎走 npmmirror，避免 deb.debian.org 被重置/超时。
# 本地/海外构建传 --build-arg CN=0 走上游源（mirrors.aliyun.com 在海外/本地不一定可达）。
ARG CN=1
# workspace 安装含 worker 的 hyperframes→onnxruntime-node，其安装脚本从 github 下载原生库国内 302 失败；跳过（本项目渲染不走 ONNX）
ENV ONNXRUNTIME_NODE_INSTALL=skip
RUN if [ "$CN" = "1" ]; then sed -i -e 's|deb.debian.org|mirrors.aliyun.com|g' -e 's|security.debian.org|mirrors.aliyun.com|g' /etc/apt/sources.list.d/debian.sources 2>/dev/null || true; fi; \
    apt-get update && apt-get install -y ffmpeg fonts-noto-cjk && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json* ./
COPY web/package.json web/
COPY worker/package.json worker/
COPY packages/db/package.json packages/db/
RUN if [ "$CN" = "1" ]; then npm install --registry=https://registry.npmmirror.com; else npm install; fi

FROM base AS prod
ARG CN=1
# 生产构建/运行必须 NODE_ENV=production，否则 next build 预渲染会拉到 dev React 运行时而失败
ENV NODE_ENV=production
COPY . .
RUN if [ "$CN" = "1" ]; then export PRISMA_ENGINES_MIRROR=https://registry.npmmirror.com/-/binary/prisma; fi; \
    npx prisma generate --schema packages/db/prisma/schema.prisma
RUN npm run build -w web
EXPOSE 3000
CMD ["npm", "run", "start", "-w", "web"]
