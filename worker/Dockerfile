FROM node:20-bookworm-slim AS base
# CN=1（默认，国内服务器）：apt 换阿里云源、npm 换 npmmirror、prisma 引擎走 npmmirror，避免 deb.debian.org 被重置/超时。
# 本地/海外构建传 --build-arg CN=0 走上游源（mirrors.aliyun.com 在海外/本地不一定可达）。
ARG CN=1
RUN if [ "$CN" = "1" ]; then sed -i -e 's|deb.debian.org|mirrors.aliyun.com|g' -e 's|security.debian.org|mirrors.aliyun.com|g' /etc/apt/sources.list.d/debian.sources 2>/dev/null || true; fi; \
    apt-get update && apt-get install -y ffmpeg fonts-noto-cjk chromium && rm -rf /var/lib/apt/lists/*
# HyperFrames(render-visuals) 用无头浏览器截帧渲染，需系统 Chromium；渲染代码默认读 /usr/bin/chromium
ENV HYPERFRAMES_BROWSER_PATH=/usr/bin/chromium
# hyperframes 依赖 onnxruntime-node，其安装脚本从 github 下载原生库（国内 302 失败）；跳过——本项目渲染不走 ONNX 推理
ENV ONNXRUNTIME_NODE_INSTALL=skip
WORKDIR /app
COPY package.json package-lock.json* ./
COPY web/package.json web/
COPY worker/package.json worker/
COPY packages/db/package.json packages/db/
RUN if [ "$CN" = "1" ]; then npm install --registry=https://registry.npmmirror.com; else npm install; fi

FROM base AS prod
ARG CN=1
ENV NODE_ENV=production
COPY . .
RUN if [ "$CN" = "1" ]; then export PRISMA_ENGINES_MIRROR=https://registry.npmmirror.com/-/binary/prisma; fi; \
    npx prisma generate --schema packages/db/prisma/schema.prisma
CMD ["npm", "run", "start", "-w", "worker"]
