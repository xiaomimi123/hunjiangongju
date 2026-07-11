FROM node:20-bookworm-slim AS base
RUN apt-get update && apt-get install -y ffmpeg fonts-noto-cjk && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json* ./
COPY web/package.json web/
COPY worker/package.json worker/
COPY packages/db/package.json packages/db/
RUN npm install

FROM base AS prod
# 生产构建/运行必须 NODE_ENV=production，否则 next build 预渲染会拉到 dev React 运行时而失败
ENV NODE_ENV=production
COPY . .
RUN npx prisma generate --schema packages/db/prisma/schema.prisma
RUN npm run build -w web
EXPOSE 3000
CMD ["npm", "run", "start", "-w", "web"]
