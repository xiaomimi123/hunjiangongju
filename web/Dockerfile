FROM node:20-bookworm-slim AS base
# 国内服务器构建：apt 换阿里云源、npm 换 npmmirror、prisma 引擎走 npmmirror，避免 deb.debian.org 被重置/超时
ENV PRISMA_ENGINES_MIRROR=https://registry.npmmirror.com/-/binary/prisma
RUN sed -i -e 's|deb.debian.org|mirrors.aliyun.com|g' -e 's|security.debian.org|mirrors.aliyun.com|g' /etc/apt/sources.list.d/debian.sources 2>/dev/null || true; \
    apt-get update && apt-get install -y ffmpeg fonts-noto-cjk && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json* ./
COPY web/package.json web/
COPY worker/package.json worker/
COPY packages/db/package.json packages/db/
RUN npm install --registry=https://registry.npmmirror.com

FROM base AS prod
# 生产构建/运行必须 NODE_ENV=production，否则 next build 预渲染会拉到 dev React 运行时而失败
ENV NODE_ENV=production
COPY . .
RUN npx prisma generate --schema packages/db/prisma/schema.prisma
RUN npm run build -w web
EXPOSE 3000
CMD ["npm", "run", "start", "-w", "web"]
