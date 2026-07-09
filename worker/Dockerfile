FROM node:20-bookworm-slim AS base
RUN apt-get update && apt-get install -y ffmpeg fonts-noto-cjk && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json* ./
COPY web/package.json web/
COPY worker/package.json worker/
COPY packages/db/package.json packages/db/
RUN npm install

FROM base AS prod
COPY . .
RUN npx prisma generate --schema packages/db/prisma/schema.prisma
CMD ["npm", "run", "start", "-w", "worker"]
