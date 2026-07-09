# 投流素材混剪工具 MVP 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 跑通"运营建素材库+文案 → 学员一键生成 → 自动分镜/渲染 → 自动质检 → 导出成片"完整闭环，本地 Docker Compose 部署，两端移动优先。

**Architecture:** npm workspaces 单仓库：`web/`（Next.js 14 App Router，学员端+运营后台+API Routes）、`worker/`（Node + BullMQ + FFmpeg 长任务）、`packages/db`（共享 Prisma client、纯函数管线逻辑、队列封装）。任务状态机驱动，Redis 队列串联四个 job（segment-script → match-materials → render-draft → run-qc）。

**Tech Stack:** Next.js 14.2 + TypeScript + Tailwind CSS 3.4、Prisma 5.22 + PostgreSQL 16、BullMQ 5 + Redis 7、fluent-ffmpeg（FFmpeg 拼接/烧字幕/质检）、jose（JWT）+ bcryptjs、vitest（单元测试）、Docker Compose。

## Global Constraints

- 上游文档：`docs/superpowers/specs/2026-07-09-mixcut-mvp-design.md`（spec）与《投流素材混剪工具_MVP开发文档_v1.0.md》（数据库/API/页面清单以它为准）。
- 所有 UI 为中文、移动端优先（375px 视口必须可用），运营后台与学员端都是。
- 输出规格两种：`9:16`（1080×1920）与 `16:9`（1920×1080），建任务时选择。
- 数据卷：容器内 `/data`（环境变量 `DATA_DIR`），子目录 `materials/`、`exports/`。
- JWT 存 httpOnly cookie，cookie 名固定 `token`；密码 bcryptjs 哈希。
- 运行时命令一律通过 `docker compose -f docker-compose.yml -f docker-compose.dev.yml` 执行（下文简写 `dc`，建议 `alias dc='docker compose -f docker-compose.yml -f docker-compose.dev.yml'`）；单元测试在宿主机跑 `npx vitest run`（纯函数，不依赖 DB）。
- 任务状态集合（`tasks.status`）：`CREATED SEGMENTING MATCHING MATERIAL_PENDING STORYBOARD_READY RENDERING PREVIEW_PENDING REVISING QC_RUNNING QC_PASSED QC_FAILED EXPORTED FAILED`。
- **对开发文档状态图的三处明确补充**（原因：可执行性）：① 新增 `FAILED` 状态承接 job 异常，学员端"失败重试"入口用它；② `REVISING → RENDERING → PREVIEW_PENDING`（换素材/改字幕后必须重渲染才能预览，开发文档的 REVISING→PREVIEW_PENDING 隐含了这一步）；③ `QC_FAILED → QC_RUNNING`（retry-qc 直接重跑质检）。
- 提交信息格式 `feat:/fix:/test:/chore:` 前缀，中文描述，每个任务至少一次提交。
- 中文字幕/水印字体：容器内安装 `fonts-noto-cjk`，FFmpeg 用 `Noto Sans CJK SC`。

---

### Task 1: Monorepo 脚手架 + Docker Compose 基座

**Files:**
- Create: `package.json`、`.env.example`、`.env`、`.dockerignore`、`vitest.config.ts`
- Create: `packages/db/package.json`、`packages/db/src/index.ts`
- Create: `web/package.json`、`web/next.config.mjs`、`web/tsconfig.json`、`web/tailwind.config.ts`、`web/postcss.config.mjs`、`web/app/layout.tsx`、`web/app/globals.css`、`web/app/(student)/page.tsx`、`web/Dockerfile`
- Create: `worker/package.json`、`worker/tsconfig.json`、`worker/src/index.ts`、`worker/Dockerfile`
- Create: `docker-compose.yml`、`docker-compose.dev.yml`
- Modify: `.gitignore`

**Interfaces:**
- Produces: workspace 布局（`@mixcut/db` 可被 web/worker `import`）；`dc up -d` 起四容器；`DATA_DIR`/`DATABASE_URL`/`REDIS_HOST`/`JWT_SECRET` 环境变量约定。

- [ ] **Step 1: 根目录文件**

`package.json`:
```json
{
  "name": "mixcut",
  "private": true,
  "workspaces": ["packages/db", "web", "worker"],
  "scripts": { "test": "vitest run" },
  "devDependencies": {
    "typescript": "^5.4.5",
    "vitest": "^1.6.0"
  }
}
```

`.env.example`（复制一份为 `.env`）:
```
DATABASE_URL=postgresql://mixcut:mixcut@postgres:5432/mixcut
REDIS_HOST=redis
REDIS_PORT=6379
JWT_SECRET=dev-secret-change-me
DATA_DIR=/data
```

`.dockerignore`:
```
node_modules
**/node_modules
.next
**/.next
data
.git
docs
*.docx
*.md
```

`vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config'
export default defineConfig({
  test: {
    include: ['packages/**/*.test.ts', 'web/**/*.test.ts', 'worker/**/*.test.ts'],
    passWithNoTests: true,
  },
})
```

`.gitignore` 追加（保留已有行）:
```
data/
.env
node_modules/
.next/
next-env.d.ts
```

- [ ] **Step 2: packages/db 占位包**

`packages/db/package.json`:
```json
{
  "name": "@mixcut/db",
  "version": "0.0.1",
  "main": "src/index.ts",
  "types": "src/index.ts",
  "dependencies": {
    "@prisma/client": "^5.22.0",
    "bullmq": "^5.8.0"
  },
  "devDependencies": { "prisma": "^5.22.0" }
}
```

`packages/db/src/index.ts`（Task 2 会替换）:
```ts
export const DB_PACKAGE_READY = true
```

- [ ] **Step 3: web 骨架**

`web/package.json`:
```json
{
  "name": "web",
  "version": "0.0.1",
  "private": true,
  "scripts": {
    "dev": "next dev -H 0.0.0.0",
    "build": "next build",
    "start": "next start -H 0.0.0.0"
  },
  "dependencies": {
    "@mixcut/db": "*",
    "bcryptjs": "^2.4.3",
    "fluent-ffmpeg": "^2.1.3",
    "jose": "^5.2.4",
    "next": "^14.2.5",
    "react": "^18.3.1",
    "react-dom": "^18.3.1"
  },
  "devDependencies": {
    "@types/bcryptjs": "^2.4.6",
    "@types/fluent-ffmpeg": "^2.1.24",
    "@types/node": "^20.14.0",
    "@types/react": "^18.3.3",
    "@types/react-dom": "^18.3.0",
    "autoprefixer": "^10.4.19",
    "postcss": "^8.4.38",
    "tailwindcss": "^3.4.4"
  }
}
```

`web/next.config.mjs`:
```js
/** @type {import('next').NextConfig} */
const nextConfig = { transpilePackages: ['@mixcut/db'] }
export default nextConfig
```

`web/tsconfig.json`:
```json
{
  "compilerOptions": {
    "lib": ["dom", "dom.iterable", "esnext"],
    "allowJs": true,
    "skipLibCheck": true,
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "incremental": true,
    "plugins": [{ "name": "next" }],
    "paths": { "@/*": ["./*"] }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

`web/tailwind.config.ts`:
```ts
import type { Config } from 'tailwindcss'
export default {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: { extend: {} },
  plugins: [],
} satisfies Config
```

`web/postcss.config.mjs`:
```js
export default { plugins: { tailwindcss: {}, autoprefixer: {} } }
```

`web/app/globals.css`:
```css
@tailwind base;
@tailwind components;
@tailwind utilities;
```

`web/app/layout.tsx`:
```tsx
import './globals.css'
import type { Metadata, Viewport } from 'next'

export const metadata: Metadata = { title: '投流素材混剪工具' }
export const viewport: Viewport = { width: 'device-width', initialScale: 1, maximumScale: 1 }

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body className="min-h-dvh bg-gray-50 text-gray-900">{children}</body>
    </html>
  )
}
```

`web/app/(student)/page.tsx`（占位，Task 13 替换）:
```tsx
export default function Home() {
  return <main className="p-4">投流素材混剪工具 — 施工中</main>
}
```

- [ ] **Step 4: worker 骨架**

`worker/package.json`:
```json
{
  "name": "worker",
  "version": "0.0.1",
  "private": true,
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "start": "tsx src/index.ts",
    "seed": "tsx src/seed.ts"
  },
  "dependencies": {
    "@mixcut/db": "*",
    "bcryptjs": "^2.4.3",
    "bullmq": "^5.8.0",
    "fluent-ffmpeg": "^2.1.3",
    "tsx": "^4.16.0"
  },
  "devDependencies": {
    "@types/bcryptjs": "^2.4.6",
    "@types/fluent-ffmpeg": "^2.1.24",
    "@types/node": "^20.14.0"
  }
}
```

`worker/tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "es2022",
    "module": "nodenext",
    "moduleResolution": "nodenext",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "noEmit": true
  },
  "include": ["src/**/*.ts", "../packages/db/src/**/*.ts"]
}
```

`worker/src/index.ts`（占位，Task 10 替换）:
```ts
console.log('[worker] started')
setInterval(() => console.log('[worker] heartbeat'), 60_000)
```

- [ ] **Step 5: Dockerfile 与 Compose**

`web/Dockerfile`:
```dockerfile
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
RUN npm run build -w web
EXPOSE 3000
CMD ["npm", "run", "start", "-w", "web"]
```

`worker/Dockerfile`:
```dockerfile
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
```

`docker-compose.yml`（生产/基座；本地开发用 dev 覆盖文件）:
```yaml
services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: mixcut
      POSTGRES_PASSWORD: mixcut
      POSTGRES_DB: mixcut
    volumes:
      - pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U mixcut"]
      interval: 5s
      timeout: 3s
      retries: 10
  redis:
    image: redis:7-alpine
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 5s
      timeout: 3s
      retries: 10
  web:
    build: { context: ., dockerfile: web/Dockerfile }
    ports: ["3000:3000"]
    env_file: .env
    volumes: ["./data:/data"]
    depends_on:
      postgres: { condition: service_healthy }
      redis: { condition: service_healthy }
  worker:
    build: { context: ., dockerfile: worker/Dockerfile }
    env_file: .env
    volumes: ["./data:/data"]
    depends_on:
      postgres: { condition: service_healthy }
      redis: { condition: service_healthy }
volumes:
  pgdata:
```

`docker-compose.dev.yml`（开发覆盖：只构建 base 阶段 + 源码卷挂载热更新）:
```yaml
services:
  web:
    build: { context: ., dockerfile: web/Dockerfile, target: base }
    command: sh -c "npm install && (npx prisma generate --schema packages/db/prisma/schema.prisma || true) && npm run dev -w web"
    environment:
      NODE_ENV: development
    volumes:
      - .:/app
      - web_node_modules:/app/node_modules
      - ./data:/data
  worker:
    build: { context: ., dockerfile: worker/Dockerfile, target: base }
    command: sh -c "npm install && (npx prisma generate --schema packages/db/prisma/schema.prisma || true) && npm run dev -w worker"
    environment:
      NODE_ENV: development
    volumes:
      - .:/app
      - worker_node_modules:/app/node_modules
      - ./data:/data
volumes:
  web_node_modules:
  worker_node_modules:
```

- [ ] **Step 6: 宿主机安装依赖（生成 package-lock.json，供单测与 IDE）**

Run: `npm install`
Expected: 生成 `package-lock.json`，无 error（warning 可忽略）。

Run: `npx vitest run`
Expected: `No test files found, exiting with code 0`（passWithNoTests）。

- [ ] **Step 7: 起容器验证**

Run: `mkdir -p data/materials data/exports && docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d --build`
Expected: 四个服务启动（首次 npm install 需几分钟，`dc logs -f web` 直到出现 `Ready in`）。

Run: `curl -s http://localhost:3000 | grep 施工中`
Expected: 输出包含"施工中"。

Run: `docker compose -f docker-compose.yml -f docker-compose.dev.yml logs worker | grep started`
Expected: `[worker] started`。

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "chore: monorepo 脚手架与 Docker Compose 基座"
```

---

### Task 2: Prisma schema + 迁移

**Files:**
- Create: `packages/db/prisma/schema.prisma`、`packages/db/src/client.ts`
- Modify: `packages/db/src/index.ts`

**Interfaces:**
- Produces: `import { prisma } from '@mixcut/db'`（PrismaClient 单例）；全部表模型（camelCase 字段 ↔ 开发文档 snake_case 列）。开发文档 schema 基础上新增：`Script.status`（draft/published）、`Task.aspectRatio`（'9:16'/'16:9'）。

- [ ] **Step 1: 写 schema**

`packages/db/prisma/schema.prisma`:
```prisma
generator client {
  provider      = "prisma-client-js"
  binaryTargets = ["native", "debian-openssl-3.0.x"]
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model User {
  id           String      @id @default(uuid())
  account      String      @unique
  passwordHash String      @map("password_hash")
  role         String      @default("student")
  createdAt    DateTime    @default(now()) @map("created_at")
  accessKeys   AccessKey[]
  tasks        Task[]

  @@map("users")
}

model AccessKey {
  id        String    @id @default(uuid())
  keyValue  String    @unique @map("key_value")
  userId    String?   @map("user_id")
  user      User?     @relation(fields: [userId], references: [id])
  expiresAt DateTime? @map("expires_at")
  isActive  Boolean   @default(true) @map("is_active")

  @@map("access_keys")
}

model Script {
  id        String          @id @default(uuid())
  title     String
  content   String
  status    String          @default("draft")
  createdBy String?         @map("created_by")
  createdAt DateTime        @default(now()) @map("created_at")
  segments  ScriptSegment[]
  tasks     Task[]

  @@map("scripts")
}

model ScriptSegment {
  id           String        @id @default(uuid())
  scriptId     String        @map("script_id")
  script       Script        @relation(fields: [scriptId], references: [id])
  seqNo        Int           @map("seq_no")
  text         String
  tags         SegmentTag[]
  taskSegments TaskSegment[]

  @@map("script_segments")
}

model TagCategory {
  id           String        @id @default(uuid())
  name         String
  parentId     String?       @map("parent_id")
  parent       TagCategory?  @relation("TagTree", fields: [parentId], references: [id])
  children     TagCategory[] @relation("TagTree")
  sortOrder    Int           @default(0) @map("sort_order")
  materialTags MaterialTag[]
  segmentTags  SegmentTag[]

  @@map("tag_categories")
}

model Material {
  id           String        @id @default(uuid())
  fileUrl      String        @map("file_url")
  thumbnailUrl String?       @map("thumbnail_url")
  durationMs   Int?          @map("duration_ms")
  uploadedBy   String?       @map("uploaded_by")
  createdAt    DateTime      @default(now()) @map("created_at")
  tags         MaterialTag[]
  taskSegments TaskSegment[]

  @@map("materials")
}

model MaterialTag {
  materialId String      @map("material_id")
  material   Material    @relation(fields: [materialId], references: [id], onDelete: Cascade)
  tagId      String      @map("tag_id")
  tag        TagCategory @relation(fields: [tagId], references: [id])

  @@id([materialId, tagId])
  @@map("material_tags")
}

model SegmentTag {
  segmentId String        @map("segment_id")
  segment   ScriptSegment @relation(fields: [segmentId], references: [id], onDelete: Cascade)
  tagId     String        @map("tag_id")
  tag       TagCategory   @relation(fields: [tagId], references: [id])

  @@id([segmentId, tagId])
  @@map("segment_tags")
}

model Task {
  id          String          @id @default(uuid())
  userId      String?         @map("user_id")
  user        User?           @relation(fields: [userId], references: [id])
  scriptId    String?         @map("script_id")
  script      Script?         @relation(fields: [scriptId], references: [id])
  status      String          @default("CREATED")
  aspectRatio String          @default("9:16") @map("aspect_ratio")
  createdAt   DateTime        @default(now()) @map("created_at")
  updatedAt   DateTime        @default(now()) @updatedAt @map("updated_at")
  segments    TaskSegment[]
  statusLogs  TaskStatusLog[]
  qcReports   QcReport[]
  exports     Export[]

  @@map("tasks")
}

model TaskSegment {
  id           String         @id @default(uuid())
  taskId       String         @map("task_id")
  task         Task           @relation(fields: [taskId], references: [id], onDelete: Cascade)
  segmentId    String?        @map("segment_id")
  segment      ScriptSegment? @relation(fields: [segmentId], references: [id])
  materialId   String?        @map("material_id")
  material     Material?      @relation(fields: [materialId], references: [id])
  orderNo      Int            @map("order_no")
  startMs      Int            @default(0) @map("start_ms")
  endMs        Int?           @map("end_ms")
  subtitleText String?        @map("subtitle_text")

  @@map("task_segments")
}

model TaskStatusLog {
  id         String   @id @default(uuid())
  taskId     String   @map("task_id")
  task       Task     @relation(fields: [taskId], references: [id], onDelete: Cascade)
  fromStatus String?  @map("from_status")
  toStatus   String   @map("to_status")
  note       String?
  createdAt  DateTime @default(now()) @map("created_at")

  @@map("task_status_logs")
}

model QcReport {
  id        String   @id @default(uuid())
  taskId    String   @map("task_id")
  task      Task     @relation(fields: [taskId], references: [id], onDelete: Cascade)
  checkType String   @map("check_type")
  result    String
  detail    String?
  createdAt DateTime @default(now()) @map("created_at")

  @@map("qc_reports")
}

model Export {
  id             String   @id @default(uuid())
  taskId         String   @map("task_id")
  task           Task     @relation(fields: [taskId], references: [id], onDelete: Cascade)
  videoUrl       String?  @map("video_url")
  subtitleUrl    String?  @map("subtitle_url")
  projectJsonUrl String?  @map("project_json_url")
  createdAt      DateTime @default(now()) @map("created_at")

  @@map("exports")
}
```

- [ ] **Step 2: client 单例与导出**

`packages/db/src/client.ts`:
```ts
import { PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient }
export const prisma = globalForPrisma.prisma ?? new PrismaClient()
if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma
```

`packages/db/src/index.ts`（整体替换）:
```ts
export { prisma } from './client'
```

- [ ] **Step 3: 容器内执行迁移**

Run: `docker compose -f docker-compose.yml -f docker-compose.dev.yml exec web npx prisma migrate dev --schema packages/db/prisma/schema.prisma --name init`
Expected: `Your database is now in sync with your schema`，生成 `packages/db/prisma/migrations/*_init/`。

Run: `npx prisma generate --schema packages/db/prisma/schema.prisma`（宿主机，供 IDE/单测类型）
Expected: `Generated Prisma Client`。

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat: Prisma schema 与初始迁移（含 script.status 与 task.aspect_ratio）"
```

---

### Task 3: 管线纯函数（TDD 核心）

**Files:**
- Create: `packages/db/src/pipeline.ts`、`packages/db/src/pipeline.test.ts`
- Modify: `packages/db/src/index.ts`

**Interfaces:**
- Produces（后续所有任务依赖的精确签名）:
  - `splitScript(content: string): string[]` — 按换行/空行切自然段
  - `scoreMaterial(segTagIds: string[], matTagIds: string[]): number` — 标签交集数
  - `estimateDurationMs(text: string): number` — 语速 6 字/秒，最短 1500ms
  - `checkSubtitleOverflow(text: string, durationMs: number): boolean` — true=越界(fail)
  - `msToSrtTime(ms: number): string`、`buildSrt(items: {text: string; startMs: number; endMs: number}[]): string`
  - `TRANSITIONS: Record<string, string[]>`、`canTransition(from: string, to: string): boolean`
  - `DIMS: Record<'9:16' | '16:9', { w: number; h: number }>`
  - 常量 `CHARS_PER_SEC = 6`、`MIN_SEGMENT_MS = 1500`

- [ ] **Step 1: 写失败测试**

`packages/db/src/pipeline.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import {
  splitScript, scoreMaterial, estimateDurationMs, checkSubtitleOverflow,
  msToSrtTime, buildSrt, canTransition, DIMS,
} from './pipeline'

describe('splitScript 按自然段切分', () => {
  it('按换行切段并去掉空段与首尾空白', () => {
    expect(splitScript('第一段\n第二段\n\n  第三段  \n')).toEqual(['第一段', '第二段', '第三段'])
  })
  it('支持 \\r\\n', () => {
    expect(splitScript('a\r\nb')).toEqual(['a', 'b'])
  })
  it('全空内容返回空数组', () => {
    expect(splitScript('\n  \n')).toEqual([])
  })
})

describe('scoreMaterial 标签重合度', () => {
  it('交集计数', () => {
    expect(scoreMaterial(['t1', 't2', 't3'], ['t2', 't3', 't9'])).toBe(2)
  })
  it('无交集为 0', () => {
    expect(scoreMaterial(['t1'], ['t2'])).toBe(0)
  })
})

describe('estimateDurationMs 语速估时', () => {
  it('12 个字 ÷ 6字/秒 = 2000ms', () => {
    expect(estimateDurationMs('一二三四五六七八九十一二')).toBe(2000)
  })
  it('短文本保底 1500ms', () => {
    expect(estimateDurationMs('好')).toBe(1500)
  })
})

describe('checkSubtitleOverflow 字幕越界', () => {
  it('语速在阈值内不越界', () => {
    expect(checkSubtitleOverflow('一二三四五六', 1000)).toBe(false) // 6字/秒
  })
  it('明显超速判越界', () => {
    expect(checkSubtitleOverflow('一二三四五六七八九十', 1000)).toBe(true) // 10字/秒
  })
})

describe('SRT 生成', () => {
  it('毫秒转 SRT 时间戳', () => {
    expect(msToSrtTime(3661234)).toBe('01:01:01,234')
    expect(msToSrtTime(0)).toBe('00:00:00,000')
  })
  it('拼装 SRT 块', () => {
    const srt = buildSrt([
      { text: '你好', startMs: 0, endMs: 1500 },
      { text: '世界', startMs: 1500, endMs: 3000 },
    ])
    expect(srt).toBe(
      '1\n00:00:00,000 --> 00:00:01,500\n你好\n\n2\n00:00:01,500 --> 00:00:03,000\n世界\n'
    )
  })
})

describe('状态机转移表', () => {
  it('合法转移', () => {
    expect(canTransition('CREATED', 'SEGMENTING')).toBe(true)
    expect(canTransition('MATCHING', 'MATERIAL_PENDING')).toBe(true)
    expect(canTransition('MATERIAL_PENDING', 'MATCHING')).toBe(true)
    expect(canTransition('PREVIEW_PENDING', 'QC_RUNNING')).toBe(true)
    expect(canTransition('QC_FAILED', 'REVISING')).toBe(true)
    expect(canTransition('REVISING', 'RENDERING')).toBe(true)
    expect(canTransition('QC_PASSED', 'EXPORTED')).toBe(true)
    expect(canTransition('FAILED', 'SEGMENTING')).toBe(true)
  })
  it('非法转移', () => {
    expect(canTransition('CREATED', 'EXPORTED')).toBe(false)
    expect(canTransition('EXPORTED', 'RENDERING')).toBe(false)
    expect(canTransition('不存在', 'CREATED')).toBe(false)
  })
})

describe('输出规格', () => {
  it('两种规格分辨率', () => {
    expect(DIMS['9:16']).toEqual({ w: 1080, h: 1920 })
    expect(DIMS['16:9']).toEqual({ w: 1920, h: 1080 })
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run packages/db/src/pipeline.test.ts`
Expected: FAIL，`Cannot find module './pipeline'` 或全部用例报错。

- [ ] **Step 3: 实现**

`packages/db/src/pipeline.ts`:
```ts
export const CHARS_PER_SEC = 6
export const MIN_SEGMENT_MS = 1500
const OVERFLOW_TOLERANCE = 0.5

export const DIMS: Record<'9:16' | '16:9', { w: number; h: number }> = {
  '9:16': { w: 1080, h: 1920 },
  '16:9': { w: 1920, h: 1080 },
}

export function splitScript(content: string): string[] {
  return content.split(/\r?\n+/).map((s) => s.trim()).filter(Boolean)
}

export function scoreMaterial(segTagIds: string[], matTagIds: string[]): number {
  const set = new Set(matTagIds)
  return segTagIds.filter((id) => set.has(id)).length
}

export function estimateDurationMs(text: string): number {
  return Math.max(MIN_SEGMENT_MS, Math.ceil((text.length / CHARS_PER_SEC) * 1000))
}

export function checkSubtitleOverflow(text: string, durationMs: number): boolean {
  if (durationMs <= 0) return true
  return text.length / (durationMs / 1000) > CHARS_PER_SEC + OVERFLOW_TOLERANCE
}

export function msToSrtTime(ms: number): string {
  const pad = (n: number, w = 2) => String(n).padStart(w, '0')
  const h = Math.floor(ms / 3_600_000)
  const m = Math.floor(ms / 60_000) % 60
  const s = Math.floor(ms / 1000) % 60
  return `${pad(h)}:${pad(m)}:${pad(s)},${pad(ms % 1000, 3)}`
}

export function buildSrt(items: { text: string; startMs: number; endMs: number }[]): string {
  return items
    .map((it, i) => `${i + 1}\n${msToSrtTime(it.startMs)} --> ${msToSrtTime(it.endMs)}\n${it.text}\n`)
    .join('\n')
}

export const TRANSITIONS: Record<string, string[]> = {
  CREATED: ['SEGMENTING'],
  SEGMENTING: ['MATCHING', 'FAILED'],
  MATCHING: ['MATERIAL_PENDING', 'STORYBOARD_READY', 'FAILED'],
  MATERIAL_PENDING: ['MATCHING'],
  STORYBOARD_READY: ['RENDERING'],
  RENDERING: ['PREVIEW_PENDING', 'FAILED'],
  PREVIEW_PENDING: ['REVISING', 'QC_RUNNING'],
  REVISING: ['RENDERING'],
  QC_RUNNING: ['QC_PASSED', 'QC_FAILED', 'FAILED'],
  QC_FAILED: ['REVISING', 'QC_RUNNING'],
  QC_PASSED: ['EXPORTED'],
  EXPORTED: [],
  FAILED: ['SEGMENTING'],
}

export function canTransition(from: string, to: string): boolean {
  return (TRANSITIONS[from] ?? []).includes(to)
}
```

`packages/db/src/index.ts`（整体替换）:
```ts
export { prisma } from './client'
export * from './pipeline'
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run packages/db/src/pipeline.test.ts`
Expected: 全部 PASS。

- [ ] **Step 5: Commit**

```bash
git add packages/db/src
git commit -m "feat: 管线纯函数（分段/打分/估时/SRT/状态转移表）与单元测试"
```

---

### Task 4: 状态机落库 + 队列封装

**Files:**
- Create: `packages/db/src/stateMachine.ts`、`packages/db/src/queue.ts`
- Modify: `packages/db/src/index.ts`

**Interfaces:**
- Consumes: `prisma`、`canTransition`（Task 2/3）
- Produces:
  - `transitionTask(taskId: string, to: string, note?: string): Promise<void>` — 校验转移合法性，事务内更新 `tasks.status` 并写 `task_status_logs`；非法转移抛 `Error('invalid transition A -> B')`
  - `enqueue(name: JobName, taskId: string): Promise<void>`，`type JobName = 'segment-script' | 'match-materials' | 'render-draft' | 'run-qc'`
  - `redisConnection: { host: string; port: number }`；队列名固定 `'pipeline'`

- [ ] **Step 1: 实现 stateMachine**

`packages/db/src/stateMachine.ts`:
```ts
import { prisma } from './client'
import { canTransition } from './pipeline'

export async function transitionTask(taskId: string, to: string, note?: string): Promise<void> {
  const task = await prisma.task.findUniqueOrThrow({ where: { id: taskId } })
  if (!canTransition(task.status, to)) {
    throw new Error(`invalid transition ${task.status} -> ${to}`)
  }
  await prisma.$transaction([
    prisma.task.update({ where: { id: taskId }, data: { status: to } }),
    prisma.taskStatusLog.create({
      data: { taskId, fromStatus: task.status, toStatus: to, note },
    }),
  ])
}
```

- [ ] **Step 2: 实现 queue**

`packages/db/src/queue.ts`:
```ts
import { Queue } from 'bullmq'

export type JobName = 'segment-script' | 'match-materials' | 'render-draft' | 'run-qc'

export const redisConnection = {
  host: process.env.REDIS_HOST ?? 'localhost',
  port: Number(process.env.REDIS_PORT ?? 6379),
}

let queue: Queue | null = null
function getQueue(): Queue {
  if (!queue) queue = new Queue('pipeline', { connection: redisConnection })
  return queue
}

export async function enqueue(name: JobName, taskId: string): Promise<void> {
  await getQueue().add(name, { taskId }, { removeOnComplete: 100, removeOnFail: 500 })
}
```

`packages/db/src/index.ts`（整体替换）:
```ts
export { prisma } from './client'
export * from './pipeline'
export { transitionTask } from './stateMachine'
export { enqueue, redisConnection } from './queue'
export type { JobName } from './queue'
```

- [ ] **Step 3: 类型检查 + 已有单测不回归**

Run: `npx vitest run && docker compose -f docker-compose.yml -f docker-compose.dev.yml exec web npx tsc --noEmit -p web`
Expected: 单测 PASS；tsc 无错误。（transitionTask 的运行时行为在 Task 10 集成验证。）

- [ ] **Step 4: Commit**

```bash
git add packages/db/src
git commit -m "feat: 任务状态机落库与 BullMQ 队列封装"
```

---

### Task 5: 认证（JWT httpOnly cookie + 角色守卫）

**Files:**
- Create: `web/lib/jwt.ts`（edge 安全，仅 jose）、`web/lib/auth.ts`、`web/lib/api.ts`、`web/middleware.ts`
- Create: `web/app/api/auth/login/route.ts`、`web/app/api/auth/register/route.ts`、`web/app/api/auth/logout/route.ts`

**Interfaces:**
- Consumes: `prisma`（@mixcut/db）
- Produces:
  - `type Session = { userId: string; role: string }`
  - `signToken(s: Session): Promise<string>`、`verifyToken(token: string): Promise<Session | null>`（`web/lib/jwt.ts`）
  - `getSession(): Promise<Session | null>`、`requireRole(role?: 'operator'): Promise<Session>`、`class HttpError extends Error { status: number }`（`web/lib/auth.ts`）
  - `handler(fn)`：API route 包装器，捕获 HttpError → JSON 错误响应（`web/lib/api.ts`）
  - HTTP：`POST /api/auth/login` body `{account?, password?, key?}` → 200 `{role}` + Set-Cookie `token`；`POST /api/auth/register`（仅 operator）body `{account, password, role}`；`POST /api/auth/logout`

- [ ] **Step 1: jwt / auth / api 工具**

`web/lib/jwt.ts`:
```ts
import { SignJWT, jwtVerify } from 'jose'

export type Session = { userId: string; role: string }
const secret = () => new TextEncoder().encode(process.env.JWT_SECRET ?? 'dev-secret')

export async function signToken(s: Session): Promise<string> {
  return new SignJWT(s)
    .setProtectedHeader({ alg: 'HS256' })
    .setExpirationTime('7d')
    .sign(secret())
}

export async function verifyToken(token: string): Promise<Session | null> {
  try {
    const { payload } = await jwtVerify(token, secret())
    if (typeof payload.userId !== 'string' || typeof payload.role !== 'string') return null
    return { userId: payload.userId, role: payload.role }
  } catch {
    return null
  }
}
```

`web/lib/auth.ts`:
```ts
import { cookies } from 'next/headers'
import { verifyToken, type Session } from './jwt'

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message)
  }
}

export async function getSession(): Promise<Session | null> {
  const token = cookies().get('token')?.value
  return token ? verifyToken(token) : null
}

export async function requireRole(role?: 'operator'): Promise<Session> {
  const s = await getSession()
  if (!s) throw new HttpError(401, '未登录')
  if (role && s.role !== role) throw new HttpError(403, '无权限')
  return s
}
```

`web/lib/api.ts`:
```ts
import { NextRequest, NextResponse } from 'next/server'
import { HttpError } from './auth'

type Handler = (req: NextRequest, ctx: { params: Record<string, string> }) => Promise<Response>

export function handler(fn: Handler): Handler {
  return async (req, ctx) => {
    try {
      return await fn(req, ctx)
    } catch (e) {
      if (e instanceof HttpError) {
        return NextResponse.json({ error: e.message }, { status: e.status })
      }
      console.error(e)
      return NextResponse.json({ error: '服务器内部错误' }, { status: 500 })
    }
  }
}
```

- [ ] **Step 2: 登录/注册/登出路由**

`web/app/api/auth/login/route.ts`:
```ts
import { NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { prisma } from '@mixcut/db'
import { signToken } from '@/lib/jwt'
import { HttpError } from '@/lib/auth'
import { handler } from '@/lib/api'

export const POST = handler(async (req) => {
  const { account, password, key } = await req.json()
  let user
  if (key) {
    const ak = await prisma.accessKey.findUnique({ where: { keyValue: key }, include: { user: true } })
    const expired = ak?.expiresAt ? ak.expiresAt < new Date() : false
    if (!ak || !ak.isActive || expired || !ak.user) throw new HttpError(401, '密钥无效或已过期')
    user = ak.user
  } else {
    if (!account || !password) throw new HttpError(400, '请填写账号和密码')
    user = await prisma.user.findUnique({ where: { account } })
    if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
      throw new HttpError(401, '账号或密码错误')
    }
  }
  const token = await signToken({ userId: user.id, role: user.role })
  const res = NextResponse.json({ role: user.role })
  res.cookies.set('token', token, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 7 * 24 * 3600,
  })
  return res
})
```

`web/app/api/auth/register/route.ts`:
```ts
import { NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { prisma } from '@mixcut/db'
import { requireRole, HttpError } from '@/lib/auth'
import { handler } from '@/lib/api'

export const POST = handler(async (req) => {
  await requireRole('operator')
  const { account, password, role } = await req.json()
  if (!account || !password) throw new HttpError(400, '请填写账号和密码')
  if (role !== 'student' && role !== 'operator') throw new HttpError(400, 'role 须为 student 或 operator')
  const exists = await prisma.user.findUnique({ where: { account } })
  if (exists) throw new HttpError(409, '账号已存在')
  const user = await prisma.user.create({
    data: { account, passwordHash: await bcrypt.hash(password, 10), role },
  })
  return NextResponse.json({ id: user.id, account: user.account, role: user.role })
})
```

`web/app/api/auth/logout/route.ts`:
```ts
import { NextResponse } from 'next/server'

export async function POST() {
  const res = NextResponse.json({ ok: true })
  res.cookies.set('token', '', { httpOnly: true, path: '/', maxAge: 0 })
  return res
}
```

- [ ] **Step 3: 页面守卫 middleware**

`web/middleware.ts`:
```ts
import { NextRequest, NextResponse } from 'next/server'
import { verifyToken } from './lib/jwt'

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl
  if (pathname.startsWith('/login') || pathname.startsWith('/api')) return NextResponse.next()
  const token = req.cookies.get('token')?.value
  const session = token ? await verifyToken(token) : null
  if (!session) return NextResponse.redirect(new URL('/login', req.url))
  if (pathname.startsWith('/admin') && session.role !== 'operator') {
    return NextResponse.redirect(new URL('/', req.url))
  }
  return NextResponse.next()
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
```

- [ ] **Step 4: curl 验证（先手工插一个测试用户）**

Run:
```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml exec web node -e "
const b=require('bcryptjs');const{PrismaClient}=require('@prisma/client');
const p=new PrismaClient();
p.user.upsert({where:{account:'tmpop'},update:{},create:{account:'tmpop',passwordHash:b.hashSync('tmp123',10),role:'operator'}})
 .then(u=>console.log('ok',u.account)).finally(()=>p.\$disconnect())"
curl -s -c /tmp/cj.txt -X POST http://localhost:3000/api/auth/login -H 'Content-Type: application/json' -d '{"account":"tmpop","password":"tmp123"}'
curl -s -b /tmp/cj.txt -X POST http://localhost:3000/api/auth/register -H 'Content-Type: application/json' -d '{"account":"tmpstu","password":"tmp123","role":"student"}'
curl -s -X POST http://localhost:3000/api/auth/login -H 'Content-Type: application/json' -d '{"account":"tmpop","password":"wrong"}'
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3000/works
```
Expected: 依次输出 `{"role":"operator"}`、`{"id":...,"account":"tmpstu"...}`、`{"error":"账号或密码错误"}`、`307`（未登录页面重定向 /login）。

- [ ] **Step 5: Commit**

```bash
git add web
git commit -m "feat: JWT 登录/注册/登出与角色路由守卫"
```

---

### Task 6: 标签分类树 API + /admin/tags 页面 + 后台框架

**Files:**
- Create: `web/app/api/tag-categories/route.ts`、`web/app/api/tag-categories/[id]/route.ts`
- Create: `web/app/admin/layout.tsx`、`web/app/admin/tags/page.tsx`
- Create: `web/lib/fetcher.ts`、`web/lib/tagTree.ts`

**Interfaces:**
- Consumes: `handler`、`requireRole`、`HttpError`、`prisma`
- Produces:
  - HTTP：`GET /api/tag-categories` → `TagNode[]`（扁平数组：`{id,name,parentId,sortOrder}`）；`POST` body `{name, parentId?}`；`PATCH /api/tag-categories/:id` body `{name?, parentId?, sortOrder?}`；`DELETE /api/tag-categories/:id`（被素材/分段/子节点引用时 409）
  - `web/lib/fetcher.ts`: `api<T>(path: string, opts?: {method?: string; body?: unknown; form?: FormData}): Promise<T>` — JSON fetch 封装，非 2xx 抛 `Error(json.error)`
  - `web/lib/tagTree.ts`: `type TagNode = { id: string; name: string; parentId: string | null; sortOrder: number }`；`buildTree(nodes: TagNode[]): (TagNode & { children: TagNode[] })[]`（两层）；`flattenWithDepth(nodes: TagNode[]): (TagNode & { depth: number })[]`
  - 后台布局：`/admin/*` 统一顶栏 + 底部标签导航（标签/素材/文案/任务），移动优先

- [ ] **Step 1: 客户端工具**

`web/lib/fetcher.ts`:
```ts
export async function api<T>(
  path: string,
  opts: { method?: string; body?: unknown; form?: FormData } = {}
): Promise<T> {
  const res = await fetch(path, {
    method: opts.method ?? (opts.body || opts.form ? 'POST' : 'GET'),
    headers: opts.body ? { 'Content-Type': 'application/json' } : undefined,
    body: opts.form ?? (opts.body ? JSON.stringify(opts.body) : undefined),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error((data as { error?: string }).error ?? `请求失败(${res.status})`)
  return data as T
}
```

`web/lib/tagTree.ts`:
```ts
export type TagNode = { id: string; name: string; parentId: string | null; sortOrder: number }

export function buildTree(nodes: TagNode[]): (TagNode & { children: TagNode[] })[] {
  const roots = nodes.filter((n) => !n.parentId).sort((a, b) => a.sortOrder - b.sortOrder)
  return roots.map((r) => ({
    ...r,
    children: nodes.filter((n) => n.parentId === r.id).sort((a, b) => a.sortOrder - b.sortOrder),
  }))
}

export function flattenWithDepth(nodes: TagNode[]): (TagNode & { depth: number })[] {
  return buildTree(nodes).flatMap((r) => [
    { ...r, depth: 0 },
    ...r.children.map((c) => ({ ...c, depth: 1 })),
  ])
}
```

- [ ] **Step 2: API 路由**

`web/app/api/tag-categories/route.ts`:
```ts
import { NextResponse } from 'next/server'
import { prisma } from '@mixcut/db'
import { requireRole, HttpError } from '@/lib/auth'
import { handler } from '@/lib/api'

export const GET = handler(async () => {
  await requireRole()
  const tags = await prisma.tagCategory.findMany({ orderBy: [{ sortOrder: 'asc' }] })
  return NextResponse.json(tags)
})

export const POST = handler(async (req) => {
  await requireRole('operator')
  const { name, parentId } = await req.json()
  if (!name?.trim()) throw new HttpError(400, '名称不能为空')
  if (parentId) {
    const parent = await prisma.tagCategory.findUnique({ where: { id: parentId } })
    if (!parent) throw new HttpError(404, '父节点不存在')
  }
  const max = await prisma.tagCategory.aggregate({
    where: { parentId: parentId ?? null },
    _max: { sortOrder: true },
  })
  const tag = await prisma.tagCategory.create({
    data: { name: name.trim(), parentId: parentId ?? null, sortOrder: (max._max.sortOrder ?? 0) + 1 },
  })
  return NextResponse.json(tag)
})
```

`web/app/api/tag-categories/[id]/route.ts`:
```ts
import { NextResponse } from 'next/server'
import { prisma } from '@mixcut/db'
import { requireRole, HttpError } from '@/lib/auth'
import { handler } from '@/lib/api'

export const PATCH = handler(async (req, { params }) => {
  await requireRole('operator')
  const { name, parentId, sortOrder } = await req.json()
  const tag = await prisma.tagCategory.update({
    where: { id: params.id },
    data: {
      ...(name !== undefined ? { name: String(name).trim() } : {}),
      ...(parentId !== undefined ? { parentId } : {}),
      ...(sortOrder !== undefined ? { sortOrder: Number(sortOrder) } : {}),
    },
  })
  return NextResponse.json(tag)
})

export const DELETE = handler(async (_req, { params }) => {
  await requireRole('operator')
  const [mats, segs, children] = await Promise.all([
    prisma.materialTag.count({ where: { tagId: params.id } }),
    prisma.segmentTag.count({ where: { tagId: params.id } }),
    prisma.tagCategory.count({ where: { parentId: params.id } }),
  ])
  if (mats + segs > 0) throw new HttpError(409, `仍有 ${mats} 个素材、${segs} 个分段引用该标签`)
  if (children > 0) throw new HttpError(409, '请先删除子节点')
  await prisma.tagCategory.delete({ where: { id: params.id } })
  return NextResponse.json({ ok: true })
})
```

- [ ] **Step 3: 后台布局（移动优先：底部导航）**

`web/app/admin/layout.tsx`:
```tsx
import Link from 'next/link'

const NAV = [
  { href: '/admin/tags', label: '标签' },
  { href: '/admin/materials', label: '素材' },
  { href: '/admin/scripts', label: '文案' },
  { href: '/admin/tasks', label: '任务' },
]

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto flex min-h-dvh max-w-3xl flex-col">
      <header className="sticky top-0 z-10 border-b bg-white px-4 py-3 text-base font-semibold">
        运营后台
      </header>
      <main className="flex-1 p-4 pb-20">{children}</main>
      <nav className="fixed inset-x-0 bottom-0 z-10 mx-auto flex max-w-3xl border-t bg-white pb-[env(safe-area-inset-bottom)]">
        {NAV.map((n) => (
          <Link key={n.href} href={n.href} className="flex-1 py-3 text-center text-sm text-gray-700 active:bg-gray-100">
            {n.label}
          </Link>
        ))}
      </nav>
    </div>
  )
}
```

- [ ] **Step 4: 标签树管理页（可折叠两级列表）**

`web/app/admin/tags/page.tsx`:
```tsx
'use client'
import { useCallback, useEffect, useState } from 'react'
import { api } from '@/lib/fetcher'
import { buildTree, type TagNode } from '@/lib/tagTree'

export default function TagsPage() {
  const [nodes, setNodes] = useState<TagNode[]>([])
  const [name, setName] = useState('')
  const [parentId, setParentId] = useState('')
  const [open, setOpen] = useState<Record<string, boolean>>({})
  const [err, setErr] = useState('')

  const load = useCallback(async () => setNodes(await api<TagNode[]>('/api/tag-categories')), [])
  useEffect(() => { load() }, [load])

  async function run(fn: () => Promise<unknown>) {
    setErr('')
    try { await fn(); await load() } catch (e) { setErr((e as Error).message) }
  }

  const add = () => run(async () => {
    await api('/api/tag-categories', { body: { name, parentId: parentId || undefined } })
    setName('')
  })
  const rename = (id: string, old: string) => {
    const n = prompt('新名称', old)
    if (n && n !== old) run(() => api(`/api/tag-categories/${id}`, { method: 'PATCH', body: { name: n } }))
  }
  const del = (id: string) => {
    if (confirm('确认删除该节点？')) run(() => api(`/api/tag-categories/${id}`, { method: 'DELETE' }))
  }

  const tree = buildTree(nodes)
  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold">标签分类树</h1>
      {err && <p className="rounded bg-red-50 p-2 text-sm text-red-600">{err}</p>}
      <div className="space-y-2 rounded-xl border bg-white p-3">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="节点名称"
          className="w-full rounded-lg border px-3 py-2" />
        <select value={parentId} onChange={(e) => setParentId(e.target.value)}
          className="w-full rounded-lg border px-3 py-2">
          <option value="">（顶级分类）</option>
          {tree.map((r) => <option key={r.id} value={r.id}>挂在「{r.name}」下</option>)}
        </select>
        <button onClick={add} disabled={!name.trim()}
          className="w-full rounded-lg bg-blue-600 py-2 text-white disabled:opacity-40">新建节点</button>
      </div>
      <ul className="divide-y rounded-xl border bg-white">
        {tree.map((r) => (
          <li key={r.id}>
            <div className="flex items-center gap-2 px-3 py-3">
              <button onClick={() => setOpen((o) => ({ ...o, [r.id]: !o[r.id] }))} className="w-6 text-gray-500">
                {open[r.id] ? '▾' : '▸'}
              </button>
              <span className="flex-1 font-medium">{r.name}</span>
              <button onClick={() => rename(r.id, r.name)} className="px-2 text-sm text-blue-600">改名</button>
              <button onClick={() => del(r.id)} className="px-2 text-sm text-red-500">删除</button>
            </div>
            {open[r.id] && r.children.map((c) => (
              <div key={c.id} className="flex items-center gap-2 py-2 pl-12 pr-3">
                <span className="flex-1 text-sm">{c.name}</span>
                <button onClick={() => rename(c.id, c.name)} className="px-2 text-sm text-blue-600">改名</button>
                <button onClick={() => del(c.id)} className="px-2 text-sm text-red-500">删除</button>
              </div>
            ))}
          </li>
        ))}
      </ul>
    </div>
  )
}
```

- [ ] **Step 5: 验证**

Run:
```bash
curl -s -b /tmp/cj.txt -X POST http://localhost:3000/api/tag-categories -H 'Content-Type: application/json' -d '{"name":"场景"}'
curl -s -b /tmp/cj.txt http://localhost:3000/api/tag-categories
```
Expected: 创建返回带 `id` 的节点；GET 返回数组含"场景"。浏览器打开 `http://localhost:3000/admin/tags`（用 tmpop 登录），375px 视口下可新建/改名/删除、折叠展开正常。

- [ ] **Step 6: Commit**

```bash
git add web
git commit -m "feat: 标签分类树 API 与后台管理页（移动优先后台框架）"
```

---

### Task 7: 素材库（上传/缩略图/文件服务）+ /admin/materials 页面

**Files:**
- Create: `web/lib/paths.ts`、`web/lib/ffmpeg.ts`
- Create: `web/app/api/materials/route.ts`、`web/app/api/materials/[id]/route.ts`、`web/app/api/files/[...path]/route.ts`
- Create: `web/components/TagPicker.tsx`、`web/app/admin/materials/page.tsx`

**Interfaces:**
- Consumes: `handler`、`requireRole`、`HttpError`、`prisma`、`flattenWithDepth`、`api`
- Produces:
  - `web/lib/paths.ts`: `DATA_DIR: string`（`process.env.DATA_DIR ?? '/data'`）
  - `web/lib/ffmpeg.ts`: `probeDurationMs(file: string): Promise<number>`、`makeThumbnail(video: string, outJpg: string): Promise<void>`
  - HTTP：`POST /api/materials`（multipart：`file` + `tagIds` JSON 字符串）→ Material JSON；`GET /api/materials?tagId=` → `(Material & {tags:{tagId}[]})[]`；`DELETE /api/materials/:id`（被任务分镜引用时 409）；`GET /api/files/<materials|exports>/...` 流式返回（带 Range 支持，登录可访问）
  - `fileUrl` 存储格式：`/api/files/materials/<uuid>.<ext>`；缩略图 `/api/files/materials/<uuid>.jpg`
  - `web/components/TagPicker.tsx`: `<TagPicker value={string[]} onChange={(ids: string[]) => void} />` 两级缩进复选框组（素材与文案分段共用）

- [ ] **Step 1: 路径与 ffmpeg 工具**

`web/lib/paths.ts`:
```ts
export const DATA_DIR = process.env.DATA_DIR ?? '/data'
```

`web/lib/ffmpeg.ts`:
```ts
import ffmpeg from 'fluent-ffmpeg'

export function probeDurationMs(file: string): Promise<number> {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(file, (err, data) => {
      if (err) return reject(err)
      resolve(Math.round((data.format.duration ?? 0) * 1000))
    })
  })
}

export function makeThumbnail(video: string, outJpg: string): Promise<void> {
  return new Promise((resolve, reject) => {
    ffmpeg(video)
      .inputOptions(['-ss', '0.5'])
      .outputOptions(['-frames:v', '1', '-vf', 'scale=320:-2'])
      .output(outJpg)
      .on('end', () => resolve())
      .on('error', reject)
      .run()
  })
}
```

- [ ] **Step 2: 上传/列表/删除 API**

`web/app/api/materials/route.ts`:
```ts
import { NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import path from 'path'
import fs from 'fs/promises'
import { prisma } from '@mixcut/db'
import { requireRole, HttpError } from '@/lib/auth'
import { handler } from '@/lib/api'
import { DATA_DIR } from '@/lib/paths'
import { probeDurationMs, makeThumbnail } from '@/lib/ffmpeg'

export const GET = handler(async (req) => {
  await requireRole()
  const tagId = new URL(req.url).searchParams.get('tagId')
  const materials = await prisma.material.findMany({
    where: tagId ? { tags: { some: { tagId } } } : {},
    include: { tags: true },
    orderBy: { createdAt: 'desc' },
  })
  return NextResponse.json(materials)
})

export const POST = handler(async (req) => {
  const session = await requireRole('operator')
  const form = await req.formData()
  const file = form.get('file')
  if (!(file instanceof File)) throw new HttpError(400, '缺少文件')
  const tagIds: string[] = JSON.parse(String(form.get('tagIds') ?? '[]'))
  if (tagIds.length === 0) throw new HttpError(400, '请至少勾选一个标签')

  const id = randomUUID()
  const ext = (path.extname(file.name) || '.mp4').toLowerCase()
  const base = `materials/${id}`
  const abs = path.join(DATA_DIR, `${base}${ext}`)
  await fs.mkdir(path.dirname(abs), { recursive: true })
  await fs.writeFile(abs, Buffer.from(await file.arrayBuffer()))

  let durationMs = 0
  try {
    durationMs = await probeDurationMs(abs)
    await makeThumbnail(abs, path.join(DATA_DIR, `${base}.jpg`))
  } catch {
    await fs.unlink(abs).catch(() => {})
    throw new HttpError(400, '文件不是可用的视频')
  }

  const material = await prisma.material.create({
    data: {
      id,
      fileUrl: `/api/files/${base}${ext}`,
      thumbnailUrl: `/api/files/${base}.jpg`,
      durationMs,
      uploadedBy: session.userId,
      tags: { create: tagIds.map((tagId) => ({ tagId })) },
    },
    include: { tags: true },
  })
  return NextResponse.json(material)
})
```

`web/app/api/materials/[id]/route.ts`:
```ts
import { NextResponse } from 'next/server'
import { prisma } from '@mixcut/db'
import { requireRole, HttpError } from '@/lib/auth'
import { handler } from '@/lib/api'

export const DELETE = handler(async (_req, { params }) => {
  await requireRole('operator')
  const used = await prisma.taskSegment.count({ where: { materialId: params.id } })
  if (used > 0) throw new HttpError(409, `该素材被 ${used} 个任务分镜使用，不能删除`)
  await prisma.material.delete({ where: { id: params.id } })
  return NextResponse.json({ ok: true })
})
```

- [ ] **Step 3: 文件服务（Range 支持，移动端视频播放必需）**

`web/app/api/files/[...path]/route.ts`:
```ts
import { NextRequest } from 'next/server'
import path from 'path'
import fs from 'fs'
import { getSession } from '@/lib/auth'
import { DATA_DIR } from '@/lib/paths'

const MIME: Record<string, string> = {
  '.mp4': 'video/mp4', '.jpg': 'image/jpeg', '.srt': 'text/plain; charset=utf-8',
  '.json': 'application/json', '.png': 'image/png',
}

export async function GET(req: NextRequest, { params }: { params: { path: string[] } }) {
  if (!(await getSession())) return new Response('未登录', { status: 401 })
  const rel = params.path.join('/')
  const abs = path.normalize(path.join(DATA_DIR, rel))
  if (!abs.startsWith(path.normalize(DATA_DIR))) return new Response('非法路径', { status: 400 })
  if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) return new Response('不存在', { status: 404 })

  const size = fs.statSync(abs).size
  const type = MIME[path.extname(abs).toLowerCase()] ?? 'application/octet-stream'
  const range = req.headers.get('range')
  if (range) {
    const m = /bytes=(\d*)-(\d*)/.exec(range)
    const start = m?.[1] ? parseInt(m[1]) : 0
    const end = m?.[2] ? Math.min(parseInt(m[2]), size - 1) : size - 1
    const stream = fs.createReadStream(abs, { start, end })
    return new Response(stream as unknown as ReadableStream, {
      status: 206,
      headers: {
        'Content-Range': `bytes ${start}-${end}/${size}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': String(end - start + 1),
        'Content-Type': type,
      },
    })
  }
  return new Response(fs.createReadStream(abs) as unknown as ReadableStream, {
    headers: { 'Content-Length': String(size), 'Content-Type': type, 'Accept-Ranges': 'bytes' },
  })
}
```

- [ ] **Step 4: TagPicker 共用组件**

`web/components/TagPicker.tsx`:
```tsx
'use client'
import { useEffect, useState } from 'react'
import { api } from '@/lib/fetcher'
import { flattenWithDepth, type TagNode } from '@/lib/tagTree'

export default function TagPicker({ value, onChange }: { value: string[]; onChange: (ids: string[]) => void }) {
  const [nodes, setNodes] = useState<TagNode[]>([])
  useEffect(() => { api<TagNode[]>('/api/tag-categories').then(setNodes) }, [])
  const toggle = (id: string) =>
    onChange(value.includes(id) ? value.filter((v) => v !== id) : [...value, id])
  return (
    <div className="max-h-56 space-y-1 overflow-auto rounded-lg border p-2">
      {flattenWithDepth(nodes).map((n) => (
        <label key={n.id} className="flex items-center gap-2 py-1" style={{ paddingLeft: n.depth * 20 }}>
          <input type="checkbox" checked={value.includes(n.id)} onChange={() => toggle(n.id)}
            className="h-5 w-5" disabled={n.depth === 0} />
          <span className={n.depth === 0 ? 'text-sm font-medium text-gray-500' : 'text-sm'}>{n.name}</span>
        </label>
      ))}
      <p className="text-xs text-gray-400">（勾选二级节点；一级为分类名）</p>
    </div>
  )
}
```

- [ ] **Step 5: 素材管理页（含上传进度与 returnTaskId 返回入口）**

`web/app/admin/materials/page.tsx`:
```tsx
'use client'
import { Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { api } from '@/lib/fetcher'
import TagPicker from '@/components/TagPicker'

type Material = {
  id: string; fileUrl: string; thumbnailUrl: string | null
  durationMs: number | null; tags: { tagId: string }[]
}

function MaterialsInner() {
  const returnTaskId = useSearchParams().get('returnTaskId')
  const [list, setList] = useState<Material[]>([])
  const [tagIds, setTagIds] = useState<string[]>([])
  const [filter, setFilter] = useState('')
  const [progress, setProgress] = useState(-1)
  const [err, setErr] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  const load = useCallback(async () => {
    setList(await api<Material[]>(`/api/materials${filter ? `?tagId=${filter}` : ''}`))
  }, [filter])
  useEffect(() => { load() }, [load])

  function upload() {
    const file = fileRef.current?.files?.[0]
    if (!file) return setErr('请选择视频文件')
    if (tagIds.length === 0) return setErr('请至少勾选一个标签')
    setErr('')
    const fd = new FormData()
    fd.append('file', file)
    fd.append('tagIds', JSON.stringify(tagIds))
    const xhr = new XMLHttpRequest()
    xhr.open('POST', '/api/materials')
    xhr.upload.onprogress = (e) => setProgress(Math.round((e.loaded / e.total) * 100))
    xhr.onload = () => {
      setProgress(-1)
      if (xhr.status >= 400) return setErr(JSON.parse(xhr.responseText).error ?? '上传失败')
      if (fileRef.current) fileRef.current.value = ''
      setTagIds([])
      load()
    }
    xhr.onerror = () => { setProgress(-1); setErr('网络错误') }
    xhr.send(fd)
  }

  const del = async (id: string) => {
    if (!confirm('确认删除素材？')) return
    try { await api(`/api/materials/${id}`, { method: 'DELETE' }); load() } catch (e) { setErr((e as Error).message) }
  }

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold">素材库</h1>
      {returnTaskId && (
        <Link href={`/admin/tasks/${returnTaskId}`}
          className="block rounded-lg bg-amber-50 p-3 text-sm text-amber-700">
          正在为任务补充素材，上传完成后点此返回任务详情 →
        </Link>
      )}
      {err && <p className="rounded bg-red-50 p-2 text-sm text-red-600">{err}</p>}
      <div className="space-y-2 rounded-xl border bg-white p-3">
        <input ref={fileRef} type="file" accept="video/*" className="w-full text-sm" />
        <TagPicker value={tagIds} onChange={setTagIds} />
        {progress >= 0 ? (
          <div className="h-2 overflow-hidden rounded bg-gray-200">
            <div className="h-full bg-blue-500 transition-all" style={{ width: `${progress}%` }} />
          </div>
        ) : (
          <button onClick={upload} className="w-full rounded-lg bg-blue-600 py-2 text-white">上传素材</button>
        )}
      </div>
      <FilterBar value={filter} onChange={setFilter} />
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {list.map((m) => (
          <li key={m.id} className="overflow-hidden rounded-xl border bg-white">
            {m.thumbnailUrl && <img src={m.thumbnailUrl} alt="" className="aspect-video w-full object-cover" />}
            <div className="flex items-center justify-between p-2 text-xs text-gray-500">
              <span>{((m.durationMs ?? 0) / 1000).toFixed(1)}s · {m.tags.length}标签</span>
              <button onClick={() => del(m.id)} className="text-red-500">删除</button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}

function FilterBar({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [nodes, setNodes] = useState<{ id: string; name: string; parentId: string | null }[]>([])
  useEffect(() => { api<typeof nodes>('/api/tag-categories').then(setNodes) }, [])
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} className="w-full rounded-lg border px-3 py-2">
      <option value="">全部标签</option>
      {nodes.filter((n) => n.parentId).map((n) => <option key={n.id} value={n.id}>{n.name}</option>)}
    </select>
  )
}

export default function MaterialsPage() {
  return <Suspense><MaterialsInner /></Suspense>
}
```

- [ ] **Step 6: 验证**

Run（先生成一个测试视频再上传）:
```bash
ffmpeg -y -f lavfi -i color=c=red:s=1280x720:d=3 -f lavfi -i sine=frequency=440:duration=3 -c:v libx264 -pix_fmt yuv420p -c:a aac /tmp/red.mp4
TAG=$(curl -s -b /tmp/cj.txt -X POST http://localhost:3000/api/tag-categories -H 'Content-Type: application/json' -d '{"name":"临时子标签","parentId":"'$(curl -s -b /tmp/cj.txt http://localhost:3000/api/tag-categories | python3 -c 'import json,sys;print(json.load(sys.stdin)[0]["id"])')'"}' | python3 -c 'import json,sys;print(json.load(sys.stdin)["id"])')
curl -s -b /tmp/cj.txt -F "file=@/tmp/red.mp4" -F "tagIds=[\"$TAG\"]" http://localhost:3000/api/materials
curl -s -b /tmp/cj.txt http://localhost:3000/api/materials | python3 -m json.tool | head -20
```
Expected: 上传返回 material JSON（`durationMs` 约 3000，`thumbnailUrl` 非空）；列表包含该素材；浏览器访问缩略图 URL 能显示图片；`/admin/materials` 页面 375px 下上传/筛选/删除可用。

- [ ] **Step 7: Commit**

```bash
git add web
git commit -m "feat: 素材库上传/缩略图/Range 文件服务与后台素材页"
```

---

### Task 8: 文案库（CRUD/自动分段/分段打标签/发布）+ /admin/scripts 页面

**Files:**
- Create: `web/app/api/scripts/route.ts`、`web/app/api/scripts/[id]/route.ts`、`web/app/api/scripts/[id]/segment/route.ts`、`web/app/api/scripts/segments/[id]/tags/route.ts`
- Create: `web/app/admin/scripts/page.tsx`、`web/app/admin/scripts/[id]/page.tsx`

**Interfaces:**
- Consumes: `splitScript`（@mixcut/db）、`handler`、`requireRole`、`HttpError`、`prisma`、`TagPicker`、`api`
- Produces:
  - HTTP：`GET /api/scripts` → student 只返回 published，operator 返回全部（含 `_count.segments`）；`POST /api/scripts` body `{title, content}`；`PATCH /api/scripts/:id` body `{title?, content?, status?}`（status: 'draft'|'published'，发布前必须已分段）；`POST /api/scripts/:id/segment`（splitScript 落库；已有任务引用时 409）；`PATCH /api/scripts/segments/:id/tags` body `{tagIds: string[]}`（整体替换）
  - `GET /api/scripts/:id` → script + segments（含 tags）

- [ ] **Step 1: API 路由**

`web/app/api/scripts/route.ts`:
```ts
import { NextResponse } from 'next/server'
import { prisma } from '@mixcut/db'
import { requireRole, HttpError } from '@/lib/auth'
import { handler } from '@/lib/api'

export const GET = handler(async () => {
  const session = await requireRole()
  const scripts = await prisma.script.findMany({
    where: session.role === 'operator' ? {} : { status: 'published' },
    include: { _count: { select: { segments: true } } },
    orderBy: { createdAt: 'desc' },
  })
  return NextResponse.json(scripts)
})

export const POST = handler(async (req) => {
  const session = await requireRole('operator')
  const { title, content } = await req.json()
  if (!title?.trim() || !content?.trim()) throw new HttpError(400, '标题与内容不能为空')
  const script = await prisma.script.create({
    data: { title: title.trim(), content, createdBy: session.userId },
  })
  return NextResponse.json(script)
})
```

`web/app/api/scripts/[id]/route.ts`:
```ts
import { NextResponse } from 'next/server'
import { prisma } from '@mixcut/db'
import { requireRole, HttpError } from '@/lib/auth'
import { handler } from '@/lib/api'

export const GET = handler(async (_req, { params }) => {
  await requireRole()
  const script = await prisma.script.findUnique({
    where: { id: params.id },
    include: { segments: { orderBy: { seqNo: 'asc' }, include: { tags: true } } },
  })
  if (!script) throw new HttpError(404, '文案不存在')
  return NextResponse.json(script)
})

export const PATCH = handler(async (req, { params }) => {
  await requireRole('operator')
  const { title, content, status } = await req.json()
  if (status === 'published') {
    const count = await prisma.scriptSegment.count({ where: { scriptId: params.id } })
    if (count === 0) throw new HttpError(400, '发布前请先自动分段')
  }
  const script = await prisma.script.update({
    where: { id: params.id },
    data: {
      ...(title !== undefined ? { title } : {}),
      ...(content !== undefined ? { content } : {}),
      ...(status !== undefined ? { status } : {}),
    },
  })
  return NextResponse.json(script)
})
```

`web/app/api/scripts/[id]/segment/route.ts`:
```ts
import { NextResponse } from 'next/server'
import { prisma, splitScript } from '@mixcut/db'
import { requireRole, HttpError } from '@/lib/auth'
import { handler } from '@/lib/api'

export const POST = handler(async (_req, { params }) => {
  await requireRole('operator')
  const script = await prisma.script.findUnique({ where: { id: params.id } })
  if (!script) throw new HttpError(404, '文案不存在')
  const used = await prisma.taskSegment.count({
    where: { segment: { scriptId: params.id } },
  })
  if (used > 0) throw new HttpError(409, '已有任务使用该文案的分段，不能重新分段')
  const parts = splitScript(script.content)
  if (parts.length === 0) throw new HttpError(400, '文案内容为空，无法分段')
  await prisma.$transaction([
    prisma.scriptSegment.deleteMany({ where: { scriptId: params.id } }),
    prisma.scriptSegment.createMany({
      data: parts.map((text, i) => ({ scriptId: params.id, seqNo: i + 1, text })),
    }),
  ])
  const segments = await prisma.scriptSegment.findMany({
    where: { scriptId: params.id }, orderBy: { seqNo: 'asc' },
  })
  return NextResponse.json(segments)
})
```

`web/app/api/scripts/segments/[id]/tags/route.ts`:
```ts
import { NextResponse } from 'next/server'
import { prisma } from '@mixcut/db'
import { requireRole, HttpError } from '@/lib/auth'
import { handler } from '@/lib/api'

export const PATCH = handler(async (req, { params }) => {
  await requireRole('operator')
  const { tagIds } = await req.json()
  if (!Array.isArray(tagIds)) throw new HttpError(400, 'tagIds 须为数组')
  await prisma.$transaction([
    prisma.segmentTag.deleteMany({ where: { segmentId: params.id } }),
    prisma.segmentTag.createMany({
      data: tagIds.map((tagId: string) => ({ segmentId: params.id, tagId })),
    }),
  ])
  return NextResponse.json({ ok: true })
})
```

- [ ] **Step 2: 文案列表页**

`web/app/admin/scripts/page.tsx`:
```tsx
'use client'
import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { api } from '@/lib/fetcher'

type Script = { id: string; title: string; status: string; _count: { segments: number } }

export default function ScriptsPage() {
  const [list, setList] = useState<Script[]>([])
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [err, setErr] = useState('')

  const load = useCallback(async () => setList(await api<Script[]>('/api/scripts')), [])
  useEffect(() => { load() }, [load])

  async function create() {
    setErr('')
    try {
      await api('/api/scripts', { body: { title, content } })
      setTitle(''); setContent(''); load()
    } catch (e) { setErr((e as Error).message) }
  }

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold">文案库</h1>
      {err && <p className="rounded bg-red-50 p-2 text-sm text-red-600">{err}</p>}
      <div className="space-y-2 rounded-xl border bg-white p-3">
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="文案标题"
          className="w-full rounded-lg border px-3 py-2" />
        <textarea value={content} onChange={(e) => setContent(e.target.value)} rows={5}
          placeholder="文案内容（每个自然段一行，分段按换行拆分）"
          className="w-full rounded-lg border px-3 py-2" />
        <button onClick={create} disabled={!title.trim() || !content.trim()}
          className="w-full rounded-lg bg-blue-600 py-2 text-white disabled:opacity-40">新建文案</button>
      </div>
      <ul className="divide-y rounded-xl border bg-white">
        {list.map((s) => (
          <li key={s.id}>
            <Link href={`/admin/scripts/${s.id}`} className="flex items-center gap-2 px-3 py-3 active:bg-gray-50">
              <span className="flex-1">{s.title}</span>
              <span className="text-xs text-gray-400">{s._count.segments} 段</span>
              <span className={`rounded-full px-2 py-0.5 text-xs ${s.status === 'published' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                {s.status === 'published' ? '已发布' : '草稿'}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}
```

- [ ] **Step 3: 文案详情页（分段 + 打标签 + 发布）**

`web/app/admin/scripts/[id]/page.tsx`:
```tsx
'use client'
import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { api } from '@/lib/fetcher'
import TagPicker from '@/components/TagPicker'

type Segment = { id: string; seqNo: number; text: string; tags: { tagId: string }[] }
type Script = { id: string; title: string; content: string; status: string; segments: Segment[] }

export default function ScriptDetailPage() {
  const { id } = useParams<{ id: string }>()
  const [script, setScript] = useState<Script | null>(null)
  const [editing, setEditing] = useState<string | null>(null)
  const [err, setErr] = useState('')

  const load = useCallback(async () => setScript(await api<Script>(`/api/scripts/${id}`)), [id])
  useEffect(() => { load() }, [load])

  async function run(fn: () => Promise<unknown>) {
    setErr('')
    try { await fn(); await load() } catch (e) { setErr((e as Error).message) }
  }
  const doSegment = () => run(() => api(`/api/scripts/${id}/segment`, { method: 'POST' }))
  const togglePublish = () => run(() =>
    api(`/api/scripts/${id}`, { method: 'PATCH', body: { status: script?.status === 'published' ? 'draft' : 'published' } }))
  const saveTags = (segId: string, tagIds: string[]) =>
    run(() => api(`/api/scripts/segments/${segId}/tags`, { method: 'PATCH', body: { tagIds } }))

  if (!script) return <p>加载中…</p>
  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold">{script.title}</h1>
      {err && <p className="rounded bg-red-50 p-2 text-sm text-red-600">{err}</p>}
      <div className="flex gap-2">
        <button onClick={doSegment} className="flex-1 rounded-lg border bg-white py-2">自动分段</button>
        <button onClick={togglePublish}
          className={`flex-1 rounded-lg py-2 text-white ${script.status === 'published' ? 'bg-gray-500' : 'bg-green-600'}`}>
          {script.status === 'published' ? '取消发布' : '发布'}
        </button>
      </div>
      <ul className="space-y-3">
        {script.segments.map((seg) => (
          <li key={seg.id} className="rounded-xl border bg-white p-3">
            <p className="text-sm"><span className="mr-2 text-gray-400">#{seg.seqNo}</span>{seg.text}</p>
            <div className="mt-2">
              {editing === seg.id ? (
                <TagPicker value={seg.tags.map((t) => t.tagId)}
                  onChange={(ids) => saveTags(seg.id, ids)} />
              ) : (
                <button onClick={() => setEditing(seg.id)} className="text-sm text-blue-600">
                  编辑标签（当前 {seg.tags.length} 个）
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>
      {script.segments.length === 0 && <p className="text-sm text-gray-400">尚未分段，点击"自动分段"。</p>}
    </div>
  )
}
```

- [ ] **Step 4: 验证**

Run:
```bash
SID=$(curl -s -b /tmp/cj.txt -X POST http://localhost:3000/api/scripts -H 'Content-Type: application/json' -d '{"title":"测试文案","content":"这本书讲了一个动人的故事\n主角在书房里读到深夜\n结局出人意料值得一看"}' | python3 -c 'import json,sys;print(json.load(sys.stdin)["id"])')
curl -s -b /tmp/cj.txt -X POST http://localhost:3000/api/scripts/$SID/segment | python3 -c 'import json,sys;d=json.load(sys.stdin);print(len(d),"segments")'
curl -s -b /tmp/cj.txt -X PATCH http://localhost:3000/api/scripts/$SID -H 'Content-Type: application/json' -d '{"status":"published"}'
```
Expected: `3 segments`；发布返回 `"status":"published"`。浏览器 `/admin/scripts` 建文案 → 详情页分段 → 每段勾标签 → 发布，375px 可用。

- [ ] **Step 5: Commit**

```bash
git add web
git commit -m "feat: 文案库 CRUD/自动分段/分段打标签/发布"
```

---

### Task 9: 任务 API 全套

**Files:**
- Create: `web/app/api/tasks/route.ts`、`web/app/api/tasks/[id]/route.ts`、`web/app/api/tasks/[id]/segments/[segmentId]/link-material/route.ts`、`web/app/api/tasks/[id]/revise/route.ts`、`web/app/api/tasks/[id]/confirm-preview/route.ts`、`web/app/api/tasks/[id]/retry-qc/route.ts`、`web/app/api/tasks/[id]/retry/route.ts`、`web/app/api/tasks/[id]/export/route.ts`
- Create: `web/lib/taskGuard.ts`

**Interfaces:**
- Consumes: `prisma`、`transitionTask`、`enqueue`、`handler`、`requireRole`、`HttpError`
- Produces:
  - `web/lib/taskGuard.ts`: `loadTaskFor(session: Session, id: string)` — student 只能取自己的任务，否则 403；返回 task（不含关联）
  - HTTP：
    - `POST /api/tasks` body `{scriptId, aspectRatio}` → 创建 CREATED 任务并入队 `segment-script`，返回 task
    - `GET /api/tasks?status=XXX` → student 自己的 / operator 全部（含 script.title），按 createdAt desc
    - `GET /api/tasks/:id` → task + segments（orderNo asc，含 material 与 segment.text、segment tags）+ statusLogs（asc）+ qcReports + exports + script
    - `POST /api/tasks/:id/segments/:segmentId/link-material` body `{materialId}`（仅 MATERIAL_PENDING；置 materialId → MATCHING → 入队 match-materials）
    - `POST /api/tasks/:id/revise` body `{changes?: {taskSegmentId, materialId?, subtitleText?}[], order?: string[]}`（仅 PREVIEW_PENDING/QC_FAILED；应用修改 → REVISING → RENDERING → 入队 render-draft）
    - `POST /api/tasks/:id/confirm-preview`（仅 PREVIEW_PENDING → QC_RUNNING → 入队 run-qc）
    - `POST /api/tasks/:id/retry-qc`（仅 QC_FAILED → QC_RUNNING → 入队 run-qc）
    - `POST /api/tasks/:id/retry`（仅 FAILED → SEGMENTING…重新入队 segment-script。注意：retry 直接调 `enqueue('segment-script', id)`，由 job 自己做 FAILED→SEGMENTING 转移）
    - `GET /api/tasks/:id/export`（仅 EXPORTED，返回最新 exports 行）

- [ ] **Step 1: 任务归属守卫**

`web/lib/taskGuard.ts`:
```ts
import { prisma } from '@mixcut/db'
import { HttpError } from './auth'
import type { Session } from './jwt'

export async function loadTaskFor(session: Session, id: string) {
  const task = await prisma.task.findUnique({ where: { id } })
  if (!task) throw new HttpError(404, '任务不存在')
  if (session.role !== 'operator' && task.userId !== session.userId) {
    throw new HttpError(403, '无权访问该任务')
  }
  return task
}
```

- [ ] **Step 2: 创建与列表**

`web/app/api/tasks/route.ts`:
```ts
import { NextResponse } from 'next/server'
import { prisma, enqueue } from '@mixcut/db'
import { requireRole, HttpError } from '@/lib/auth'
import { handler } from '@/lib/api'

export const POST = handler(async (req) => {
  const session = await requireRole()
  const { scriptId, aspectRatio } = await req.json()
  if (aspectRatio !== '9:16' && aspectRatio !== '16:9') throw new HttpError(400, '输出规格须为 9:16 或 16:9')
  const script = await prisma.script.findUnique({
    where: { id: scriptId },
    include: { _count: { select: { segments: true } } },
  })
  if (!script || script.status !== 'published') throw new HttpError(400, '文案不存在或未发布')
  if (script._count.segments === 0) throw new HttpError(400, '文案尚未分段')
  const task = await prisma.task.create({
    data: { userId: session.userId, scriptId, aspectRatio },
  })
  await enqueue('segment-script', task.id)
  return NextResponse.json(task)
})

export const GET = handler(async (req) => {
  const session = await requireRole()
  const status = new URL(req.url).searchParams.get('status')
  const tasks = await prisma.task.findMany({
    where: {
      ...(session.role === 'operator' ? {} : { userId: session.userId }),
      ...(status ? { status } : {}),
    },
    include: { script: { select: { title: true } } },
    orderBy: { createdAt: 'desc' },
  })
  return NextResponse.json(tasks)
})
```

- [ ] **Step 3: 详情**

`web/app/api/tasks/[id]/route.ts`:
```ts
import { NextResponse } from 'next/server'
import { prisma } from '@mixcut/db'
import { requireRole } from '@/lib/auth'
import { handler } from '@/lib/api'
import { loadTaskFor } from '@/lib/taskGuard'

export const GET = handler(async (_req, { params }) => {
  const session = await requireRole()
  await loadTaskFor(session, params.id)
  const task = await prisma.task.findUnique({
    where: { id: params.id },
    include: {
      script: { select: { id: true, title: true } },
      segments: {
        orderBy: { orderNo: 'asc' },
        include: {
          material: { select: { id: true, fileUrl: true, thumbnailUrl: true, durationMs: true } },
          segment: { select: { text: true, tags: { select: { tagId: true } } } },
        },
      },
      statusLogs: { orderBy: { createdAt: 'asc' } },
      qcReports: { orderBy: { createdAt: 'desc' } },
      exports: { orderBy: { createdAt: 'desc' } },
    },
  })
  return NextResponse.json(task)
})
```

- [ ] **Step 4: 动作路由（五个）**

`web/app/api/tasks/[id]/segments/[segmentId]/link-material/route.ts`:
```ts
import { NextResponse } from 'next/server'
import { prisma, transitionTask, enqueue } from '@mixcut/db'
import { requireRole, HttpError } from '@/lib/auth'
import { handler } from '@/lib/api'

export const POST = handler(async (req, { params }) => {
  await requireRole('operator')
  const { materialId } = await req.json()
  const task = await prisma.task.findUnique({ where: { id: params.id } })
  if (!task) throw new HttpError(404, '任务不存在')
  if (task.status !== 'MATERIAL_PENDING') throw new HttpError(409, '当前状态不允许关联素材')
  const material = await prisma.material.findUnique({ where: { id: materialId } })
  if (!material) throw new HttpError(404, '素材不存在')
  await prisma.taskSegment.update({
    where: { id: params.segmentId },
    data: { materialId },
  })
  await transitionTask(params.id, 'MATCHING', `人工关联素材 ${materialId}`)
  await enqueue('match-materials', params.id)
  return NextResponse.json({ ok: true })
})
```

`web/app/api/tasks/[id]/revise/route.ts`:
```ts
import { NextResponse } from 'next/server'
import { prisma, transitionTask, enqueue } from '@mixcut/db'
import { requireRole, HttpError } from '@/lib/auth'
import { handler } from '@/lib/api'
import { loadTaskFor } from '@/lib/taskGuard'

export const POST = handler(async (req, { params }) => {
  const session = await requireRole()
  const task = await loadTaskFor(session, params.id)
  if (task.status !== 'PREVIEW_PENDING' && task.status !== 'QC_FAILED') {
    throw new HttpError(409, '当前状态不允许修改')
  }
  const { changes, order } = (await req.json()) as {
    changes?: { taskSegmentId: string; materialId?: string; subtitleText?: string }[]
    order?: string[]
  }
  const updates = []
  for (const c of changes ?? []) {
    updates.push(prisma.taskSegment.update({
      where: { id: c.taskSegmentId },
      data: {
        ...(c.materialId !== undefined ? { materialId: c.materialId } : {}),
        ...(c.subtitleText !== undefined ? { subtitleText: c.subtitleText, endMs: null } : {}),
      },
    }))
  }
  for (const [i, segId] of (order ?? []).entries()) {
    updates.push(prisma.taskSegment.update({ where: { id: segId }, data: { orderNo: i + 1 } }))
  }
  if (updates.length === 0) throw new HttpError(400, '没有任何修改')
  await prisma.$transaction(updates)
  await transitionTask(params.id, 'REVISING', '提交局部修改')
  await transitionTask(params.id, 'RENDERING', '修改后重新渲染')
  await enqueue('render-draft', params.id)
  return NextResponse.json({ ok: true })
})
```

`web/app/api/tasks/[id]/confirm-preview/route.ts`:
```ts
import { NextResponse } from 'next/server'
import { transitionTask, enqueue } from '@mixcut/db'
import { requireRole, HttpError } from '@/lib/auth'
import { handler } from '@/lib/api'
import { loadTaskFor } from '@/lib/taskGuard'

export const POST = handler(async (_req, { params }) => {
  const session = await requireRole()
  const task = await loadTaskFor(session, params.id)
  if (task.status !== 'PREVIEW_PENDING') throw new HttpError(409, '当前状态不允许确认预览')
  await transitionTask(params.id, 'QC_RUNNING', '预览确认，进入质检')
  await enqueue('run-qc', params.id)
  return NextResponse.json({ ok: true })
})
```

`web/app/api/tasks/[id]/retry-qc/route.ts`:
```ts
import { NextResponse } from 'next/server'
import { transitionTask, enqueue } from '@mixcut/db'
import { requireRole, HttpError } from '@/lib/auth'
import { handler } from '@/lib/api'
import { loadTaskFor } from '@/lib/taskGuard'

export const POST = handler(async (_req, { params }) => {
  const session = await requireRole()
  const task = await loadTaskFor(session, params.id)
  if (task.status !== 'QC_FAILED') throw new HttpError(409, '仅质检失败的任务可重新质检')
  await transitionTask(params.id, 'QC_RUNNING', '重新提交质检')
  await enqueue('run-qc', params.id)
  return NextResponse.json({ ok: true })
})
```

`web/app/api/tasks/[id]/retry/route.ts`:
```ts
import { NextResponse } from 'next/server'
import { enqueue } from '@mixcut/db'
import { requireRole, HttpError } from '@/lib/auth'
import { handler } from '@/lib/api'
import { loadTaskFor } from '@/lib/taskGuard'

export const POST = handler(async (_req, { params }) => {
  const session = await requireRole()
  const task = await loadTaskFor(session, params.id)
  if (task.status !== 'FAILED') throw new HttpError(409, '仅失败任务可重试')
  await enqueue('segment-script', params.id)
  return NextResponse.json({ ok: true })
})
```

`web/app/api/tasks/[id]/export/route.ts`:
```ts
import { NextResponse } from 'next/server'
import { prisma } from '@mixcut/db'
import { requireRole, HttpError } from '@/lib/auth'
import { handler } from '@/lib/api'
import { loadTaskFor } from '@/lib/taskGuard'

export const GET = handler(async (_req, { params }) => {
  const session = await requireRole()
  const task = await loadTaskFor(session, params.id)
  if (task.status !== 'EXPORTED') throw new HttpError(409, '任务尚未导出')
  const exp = await prisma.export.findFirst({
    where: { taskId: params.id },
    orderBy: { createdAt: 'desc' },
  })
  if (!exp) throw new HttpError(404, '导出产物不存在')
  return NextResponse.json(exp)
})
```

- [ ] **Step 5: 验证（worker 未实现，只验证创建与守卫）**

Run:
```bash
curl -s -c /tmp/cs.txt -X POST http://localhost:3000/api/auth/login -H 'Content-Type: application/json' -d '{"account":"tmpstu","password":"tmp123"}'
TID=$(curl -s -b /tmp/cs.txt -X POST http://localhost:3000/api/tasks -H 'Content-Type: application/json' -d "{\"scriptId\":\"$SID\",\"aspectRatio\":\"9:16\"}" | python3 -c 'import json,sys;print(json.load(sys.stdin)["id"])')
curl -s -b /tmp/cs.txt http://localhost:3000/api/tasks/$TID | python3 -c 'import json,sys;print(json.load(sys.stdin)["status"])'
curl -s -b /tmp/cs.txt -X POST http://localhost:3000/api/tasks -H 'Content-Type: application/json' -d '{"scriptId":"no","aspectRatio":"1:1"}'
```
Expected: 任务创建成功、状态 `CREATED`（worker 未接手前停留）；非法 aspectRatio 返回 `{"error":"输出规格须为 9:16 或 16:9"}`。

- [ ] **Step 6: Commit**

```bash
git add web
git commit -m "feat: 任务全套 API（创建/详情/关联素材/修改/确认/质检重试/导出）"
```

---

### Task 10: Worker 骨架 + segment-script + match-materials

**Files:**
- Modify: `worker/src/index.ts`（替换占位）
- Create: `worker/src/jobs/segmentScript.ts`、`worker/src/jobs/matchMaterials.ts`

**Interfaces:**
- Consumes: `prisma`、`transitionTask`、`enqueue`、`splitScript`、`estimateDurationMs`、`scoreMaterial`、`redisConnection`
- Produces:
  - `segmentScript(taskId: string): Promise<void>` — CREATED/FAILED→SEGMENTING；script 无分段则 splitScript 落库；重建 task_segments（orderNo=seqNo、subtitleText=原文、endMs=null）；→MATCHING；入队 match-materials
  - `matchMaterials(taskId: string): Promise<void>` — 仅给 `materialId == null` 的分镜打分匹配（保留人工关联）；有未匹配→MATERIAL_PENDING（note 列出段号）；全匹配→STORYBOARD_READY→RENDERING→入队 render-draft
  - worker 监听队列 `'pipeline'`，job 失败时将任务转 FAILED（若转移合法）

- [ ] **Step 1: segment-script job**

`worker/src/jobs/segmentScript.ts`:
```ts
import { prisma, transitionTask, enqueue, splitScript } from '@mixcut/db'

export async function segmentScript(taskId: string): Promise<void> {
  const task = await prisma.task.findUniqueOrThrow({
    where: { id: taskId },
    include: { script: { include: { segments: { orderBy: { seqNo: 'asc' } } } } },
  })
  await transitionTask(taskId, 'SEGMENTING', '开始脚本分段')
  if (!task.script) throw new Error('任务没有关联文案')

  let segments = task.script.segments
  if (segments.length === 0) {
    const parts = splitScript(task.script.content)
    await prisma.scriptSegment.createMany({
      data: parts.map((text, i) => ({ scriptId: task.script!.id, seqNo: i + 1, text })),
    })
    segments = await prisma.scriptSegment.findMany({
      where: { scriptId: task.script.id }, orderBy: { seqNo: 'asc' },
    })
  }

  await prisma.$transaction([
    prisma.taskSegment.deleteMany({ where: { taskId } }),
    prisma.taskSegment.createMany({
      data: segments.map((s) => ({
        taskId, segmentId: s.id, orderNo: s.seqNo, subtitleText: s.text,
      })),
    }),
  ])
  await transitionTask(taskId, 'MATCHING', `分段完成，共 ${segments.length} 段`)
  await enqueue('match-materials', taskId)
}
```

- [ ] **Step 2: match-materials job**

`worker/src/jobs/matchMaterials.ts`:
```ts
import { prisma, transitionTask, enqueue, scoreMaterial } from '@mixcut/db'

export async function matchMaterials(taskId: string): Promise<void> {
  const taskSegments = await prisma.taskSegment.findMany({
    where: { taskId },
    include: { segment: { include: { tags: true } } },
    orderBy: { orderNo: 'asc' },
  })
  const materials = await prisma.material.findMany({ include: { tags: true } })

  const unmatched: number[] = []
  for (const ts of taskSegments) {
    if (ts.materialId) continue // 保留人工关联结果
    const segTagIds = ts.segment?.tags.map((t) => t.tagId) ?? []
    let best: { id: string; score: number } | null = null
    for (const m of materials) {
      const score = scoreMaterial(segTagIds, m.tags.map((t) => t.tagId))
      if (score >= 1 && (!best || score > best.score)) best = { id: m.id, score }
    }
    if (best) {
      await prisma.taskSegment.update({ where: { id: ts.id }, data: { materialId: best.id } })
    } else {
      unmatched.push(ts.orderNo)
    }
  }

  if (unmatched.length > 0) {
    await transitionTask(taskId, 'MATERIAL_PENDING', `素材不足，待补充分镜段：${unmatched.join('、')}`)
    return
  }
  await transitionTask(taskId, 'STORYBOARD_READY', '分镜与素材匹配完成')
  await transitionTask(taskId, 'RENDERING', '开始渲染初稿')
  await enqueue('render-draft', taskId)
}
```

- [ ] **Step 3: worker 主进程（含失败兜底）**

`worker/src/index.ts`（整体替换）:
```ts
import { Worker, type Job } from 'bullmq'
import { prisma, transitionTask, canTransition, redisConnection } from '@mixcut/db'
import { segmentScript } from './jobs/segmentScript'
import { matchMaterials } from './jobs/matchMaterials'

async function dispatch(job: Job): Promise<void> {
  const { taskId } = job.data as { taskId: string }
  console.log(`[worker] ${job.name} start task=${taskId}`)
  switch (job.name) {
    case 'segment-script': return segmentScript(taskId)
    case 'match-materials': return matchMaterials(taskId)
    case 'render-draft': throw new Error('render-draft 未实现（Task 11）')
    case 'run-qc': throw new Error('run-qc 未实现（Task 12）')
    default: throw new Error(`未知 job: ${job.name}`)
  }
}

const worker = new Worker('pipeline', dispatch, { connection: redisConnection, concurrency: 2 })

worker.on('completed', (job) => console.log(`[worker] ${job.name} done task=${job.data.taskId}`))
worker.on('failed', async (job, err) => {
  console.error(`[worker] ${job?.name} failed: ${err.message}`)
  const taskId = job?.data?.taskId as string | undefined
  if (!taskId) return
  try {
    const task = await prisma.task.findUnique({ where: { id: taskId } })
    if (task && canTransition(task.status, 'FAILED')) {
      await transitionTask(taskId, 'FAILED', `${job?.name} 失败：${err.message}`)
    }
  } catch (e) {
    console.error('[worker] 记录失败状态出错', e)
  }
})

console.log('[worker] pipeline worker started')
```

- [ ] **Step 4: 集成验证（不足→补素材→匹配闭环）**

Run:
```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml restart worker
# 建一个新任务（复用 Task 9 的 $SID；此时分段还没打标签 → 应走 MATERIAL_PENDING）
TID=$(curl -s -b /tmp/cs.txt -X POST http://localhost:3000/api/tasks -H 'Content-Type: application/json' -d "{\"scriptId\":\"$SID\",\"aspectRatio\":\"9:16\"}" | python3 -c 'import json,sys;print(json.load(sys.stdin)["id"])')
sleep 3
curl -s -b /tmp/cs.txt http://localhost:3000/api/tasks/$TID | python3 -c 'import json,sys;d=json.load(sys.stdin);print(d["status"],[l["toStatus"] for l in d["statusLogs"]])'
```
Expected: 状态 `MATERIAL_PENDING`，日志包含 `SEGMENTING → MATCHING → MATERIAL_PENDING`（分段无标签匹配不到素材）。

再给全部分段打上 Task 7 上传素材用的标签后，用运营 cookie 调 link-material（任一段）：
```bash
# 给三个分段都打标签（TAG 来自 Task 7）
for SEG in $(curl -s -b /tmp/cj.txt http://localhost:3000/api/scripts/$SID | python3 -c 'import json,sys;[print(s["id"]) for s in json.load(sys.stdin)["segments"]]'); do
  curl -s -b /tmp/cj.txt -X PATCH http://localhost:3000/api/scripts/segments/$SEG/tags -H 'Content-Type: application/json' -d "{\"tagIds\":[\"$TAG\"]}"
done
TSEG=$(curl -s -b /tmp/cj.txt http://localhost:3000/api/tasks/$TID | python3 -c 'import json,sys;print(json.load(sys.stdin)["segments"][0]["id"])')
MID=$(curl -s -b /tmp/cj.txt http://localhost:3000/api/materials | python3 -c 'import json,sys;print(json.load(sys.stdin)[0]["id"])')
curl -s -b /tmp/cj.txt -X POST http://localhost:3000/api/tasks/$TID/segments/$TSEG/link-material -H 'Content-Type: application/json' -d "{\"materialId\":\"$MID\"}"
sleep 3
curl -s -b /tmp/cj.txt http://localhost:3000/api/tasks/$TID | python3 -c 'import json,sys;d=json.load(sys.stdin);print(d["status"])'
```
Expected: 状态推进到 `RENDERING` 后 job 报"render-draft 未实现"→ 任务转 `FAILED`（Task 11 后消除）。`docker compose ... logs worker` 能看到相应日志。

- [ ] **Step 5: Commit**

```bash
git add worker
git commit -m "feat: worker 管线（脚本分段与标签匹配 job，失败兜底转 FAILED）"
```

---

### Task 11: FFmpeg 渲染（render-draft：归一化/拼接/烧字幕，双规格）

**Files:**
- Create: `worker/src/ffmpeg.ts`、`worker/src/paths.ts`、`worker/src/jobs/renderDraft.ts`
- Modify: `worker/src/index.ts`（接入 render-draft 分支）

**Interfaces:**
- Consumes: `prisma`、`transitionTask`、`estimateDurationMs`、`buildSrt`、`DIMS`
- Produces:
  - `worker/src/paths.ts`: `DATA_DIR: string`、`urlToAbs(fileUrl: string): string`（`/api/files/materials/x.mp4` → `${DATA_DIR}/materials/x.mp4`）
  - `worker/src/ffmpeg.ts`:
    - `probeHasAudio(file: string): Promise<boolean>`
    - `normalizeSegment(opts: { input: string; out: string; durationMs: number; w: number; h: number }): Promise<void>` — 循环补长、等比缩放+模糊背景垫底、30fps/yuv420p/H.264/AAC 统一编码，无音轨补静音
    - `concatSegments(files: string[], out: string): Promise<void>`（concat demuxer + `-c copy`）
    - `burnSubtitles(video: string, srtPath: string, out: string): Promise<void>`（libass，Noto Sans CJK SC）
  - `renderDraft(taskId: string): Promise<void>` — 重算时间轴（endMs 空则 estimateDurationMs）→ 写回 startMs/endMs → 生成 `subtitle.srt` → 逐段归一化 → 拼接 → 烧字幕 → `data/exports/<taskId>/draft.mp4` → RENDERING→PREVIEW_PENDING
  - 产物路径约定：`${DATA_DIR}/exports/<taskId>/{draft.mp4, subtitle.srt, seg-<n>.mp4, concat.mp4}`；draft 预览 URL `/api/files/exports/<taskId>/draft.mp4`

- [ ] **Step 1: 路径与 FFmpeg 封装**

`worker/src/paths.ts`:
```ts
import path from 'path'

export const DATA_DIR = process.env.DATA_DIR ?? '/data'

export function urlToAbs(fileUrl: string): string {
  const rel = fileUrl.replace(/^\/api\/files\//, '')
  return path.join(DATA_DIR, rel)
}
```

`worker/src/ffmpeg.ts`:
```ts
import ffmpeg from 'fluent-ffmpeg'
import fs from 'fs/promises'
import path from 'path'

export function probeHasAudio(file: string): Promise<boolean> {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(file, (err, data) => {
      if (err) return reject(err)
      resolve((data.streams ?? []).some((s) => s.codec_type === 'audio'))
    })
  })
}

export async function normalizeSegment(opts: {
  input: string; out: string; durationMs: number; w: number; h: number
}): Promise<void> {
  const { input, out, durationMs, w, h } = opts
  const hasAudio = await probeHasAudio(input)
  const sec = (durationMs / 1000).toFixed(3)
  await new Promise<void>((resolve, reject) => {
    const cmd = ffmpeg(input).inputOptions(['-stream_loop', '-1'])
    if (!hasAudio) cmd.input('anullsrc=r=44100:cl=stereo').inputFormat('lavfi')
    cmd
      .complexFilter([
        `[0:v]scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h},boxblur=20:5[bg]`,
        `[0:v]scale=${w}:${h}:force_original_aspect_ratio=decrease[fg]`,
        `[bg][fg]overlay=(W-w)/2:(H-h)/2,fps=30,format=yuv420p[v]`,
      ])
      .outputOptions([
        '-map', '[v]',
        '-map', hasAudio ? '0:a:0' : '1:a:0',
        '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23',
        '-c:a', 'aac', '-ar', '44100', '-ac', '2',
        '-t', sec,
      ])
      .output(out)
      .on('end', () => resolve())
      .on('error', reject)
      .run()
  })
}

export async function concatSegments(files: string[], out: string): Promise<void> {
  const listPath = path.join(path.dirname(out), 'concat-list.txt')
  await fs.writeFile(listPath, files.map((f) => `file '${f}'`).join('\n'))
  await new Promise<void>((resolve, reject) => {
    ffmpeg(listPath)
      .inputOptions(['-f', 'concat', '-safe', '0'])
      .outputOptions(['-c', 'copy'])
      .output(out)
      .on('end', () => resolve())
      .on('error', reject)
      .run()
  })
}

export function burnSubtitles(video: string, srtPath: string, out: string): Promise<void> {
  const style = 'FontName=Noto Sans CJK SC,FontSize=14,Outline=1,MarginV=40'
  return new Promise((resolve, reject) => {
    ffmpeg(video)
      .outputOptions(['-vf', `subtitles=${srtPath}:force_style='${style}'`, '-c:a', 'copy'])
      .output(out)
      .on('end', () => resolve())
      .on('error', reject)
      .run()
  })
}
```

- [ ] **Step 2: render-draft job**

`worker/src/jobs/renderDraft.ts`:
```ts
import path from 'path'
import fs from 'fs/promises'
import { prisma, transitionTask, estimateDurationMs, buildSrt, DIMS } from '@mixcut/db'
import { DATA_DIR, urlToAbs } from '../paths'
import { normalizeSegment, concatSegments, burnSubtitles } from '../ffmpeg'

export async function renderDraft(taskId: string): Promise<void> {
  const task = await prisma.task.findUniqueOrThrow({
    where: { id: taskId },
    include: {
      segments: { orderBy: { orderNo: 'asc' }, include: { material: true } },
    },
  })
  if (task.status !== 'RENDERING') throw new Error(`状态 ${task.status} 不能渲染`)
  const dims = DIMS[task.aspectRatio as '9:16' | '16:9']
  if (!dims) throw new Error(`未知输出规格 ${task.aspectRatio}`)

  // 1. 重算时间轴并写回
  let cursor = 0
  const timeline: { text: string; startMs: number; endMs: number }[] = []
  for (const seg of task.segments) {
    if (!seg.material) throw new Error(`分镜段 ${seg.orderNo} 缺少素材`)
    const text = seg.subtitleText ?? ''
    const dur = seg.endMs && seg.endMs > seg.startMs ? seg.endMs - seg.startMs : estimateDurationMs(text)
    const startMs = cursor
    const endMs = cursor + dur
    cursor = endMs
    timeline.push({ text, startMs, endMs })
    await prisma.taskSegment.update({ where: { id: seg.id }, data: { startMs, endMs } })
  }

  // 2. 产物目录 + SRT
  const outDir = path.join(DATA_DIR, 'exports', taskId)
  await fs.mkdir(outDir, { recursive: true })
  const srtPath = path.join(outDir, 'subtitle.srt')
  await fs.writeFile(srtPath, buildSrt(timeline))

  // 3. 逐段归一化 → 拼接 → 烧字幕
  const segFiles: string[] = []
  for (const [i, seg] of task.segments.entries()) {
    const out = path.join(outDir, `seg-${i + 1}.mp4`)
    await normalizeSegment({
      input: urlToAbs(seg.material!.fileUrl),
      out,
      durationMs: timeline[i].endMs - timeline[i].startMs,
      w: dims.w,
      h: dims.h,
    })
    segFiles.push(out)
  }
  const concatPath = path.join(outDir, 'concat.mp4')
  await concatSegments(segFiles, concatPath)
  await burnSubtitles(concatPath, srtPath, path.join(outDir, 'draft.mp4'))

  await transitionTask(taskId, 'PREVIEW_PENDING', '初稿渲染完成，待预览')
}
```

- [ ] **Step 3: 接入 dispatch**

`worker/src/index.ts` 修改两处：

```ts
import { renderDraft } from './jobs/renderDraft'
```

dispatch 的 switch 中替换：
```ts
    case 'render-draft': return renderDraft(taskId)
```

- [ ] **Step 4: 集成验证**

Run:
```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml restart worker
# 重试 Task 10 里 FAILED 的任务（全部分段已有标签且素材已上传）
curl -s -b /tmp/cs.txt -X POST http://localhost:3000/api/tasks/$TID/retry
sleep 30
curl -s -b /tmp/cs.txt http://localhost:3000/api/tasks/$TID | python3 -c 'import json,sys;print(json.load(sys.stdin)["status"])'
docker compose -f docker-compose.yml -f docker-compose.dev.yml exec worker ffprobe -v error -select_streams v:0 -show_entries stream=width,height -of csv=p=0 /data/exports/$TID/draft.mp4
```
Expected: 状态 `PREVIEW_PENDING`；ffprobe 输出 `1080,1920`（9:16 任务）；浏览器登录后访问 `http://localhost:3000/api/files/exports/$TID/draft.mp4` 能播放，画面为模糊背景+居中前景，中文字幕正常显示。

- [ ] **Step 5: Commit**

```bash
git add worker
git commit -m "feat: FFmpeg 渲染 job（归一化/模糊垫底/拼接/烧字幕，双输出规格）"
```

---

### Task 12: 质检 run-qc + 导出产物

**Files:**
- Create: `worker/src/jobs/runQc.ts`
- Modify: `worker/src/ffmpeg.ts`（追加 detectBlack/detectSilence）、`worker/src/index.ts`（接入 run-qc 分支）

**Interfaces:**
- Consumes: `prisma`、`transitionTask`、`checkSubtitleOverflow`
- Produces:
  - `detectBlack(file: string): Promise<string[]>`、`detectSilence(file: string): Promise<string[]>`（返回 FFmpeg stderr 中的检测行，空数组=通过）
  - `runQc(taskId: string): Promise<void>` — 三项检测各写一行 `qc_reports`（check_type: `black_frame`/`silence`/`subtitle_overflow`，result: `pass`/`fail`）；全 pass→QC_PASSED→生成导出产物→EXPORTED；任一 fail→QC_FAILED
  - 导出产物：`${DATA_DIR}/exports/<taskId>/{final.mp4, subtitle.srt, project.json}`；`exports` 表一行三个 URL（`/api/files/exports/<taskId>/…`）

- [ ] **Step 1: 检测函数（追加到 worker/src/ffmpeg.ts）**

```ts
function runDetectFilter(file: string, kind: 'video' | 'audio', filter: string, marker: string): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const lines: string[] = []
    const cmd = ffmpeg(file)
    if (kind === 'video') cmd.outputOptions(['-vf', filter, '-an'])
    else cmd.outputOptions(['-af', filter, '-vn'])
    cmd
      .outputOptions(['-f', 'null'])
      .output('-')
      .on('stderr', (line: string) => { if (line.includes(marker)) lines.push(line.trim()) })
      .on('end', () => resolve(lines))
      .on('error', reject)
      .run()
  })
}

export function detectBlack(file: string): Promise<string[]> {
  return runDetectFilter(file, 'video', 'blackdetect=d=0.5:pix_th=0.10', 'black_start')
}

export function detectSilence(file: string): Promise<string[]> {
  return runDetectFilter(file, 'audio', 'silencedetect=noise=-50dB:d=1.0', 'silence_start')
}
```

- [ ] **Step 2: run-qc job**

`worker/src/jobs/runQc.ts`:
```ts
import path from 'path'
import fs from 'fs/promises'
import { prisma, transitionTask, checkSubtitleOverflow } from '@mixcut/db'
import { DATA_DIR } from '../paths'
import { detectBlack, detectSilence } from '../ffmpeg'

export async function runQc(taskId: string): Promise<void> {
  const task = await prisma.task.findUniqueOrThrow({
    where: { id: taskId },
    include: {
      script: { select: { title: true } },
      segments: { orderBy: { orderNo: 'asc' }, include: { material: { select: { fileUrl: true } } } },
    },
  })
  const outDir = path.join(DATA_DIR, 'exports', taskId)
  const draft = path.join(outDir, 'draft.mp4')

  const black = await detectBlack(draft)
  const silence = await detectSilence(draft)
  const overflow = task.segments.filter((s) =>
    checkSubtitleOverflow(s.subtitleText ?? '', (s.endMs ?? 0) - s.startMs)
  )

  const checks: { checkType: string; result: string; detail: string }[] = [
    {
      checkType: 'black_frame',
      result: black.length === 0 ? 'pass' : 'fail',
      detail: black.length === 0 ? '未检出黑屏' : black.join('\n'),
    },
    {
      checkType: 'silence',
      result: silence.length === 0 ? 'pass' : 'fail',
      detail: silence.length === 0 ? '未检出静音' : silence.join('\n'),
    },
    {
      checkType: 'subtitle_overflow',
      result: overflow.length === 0 ? 'pass' : 'fail',
      detail: overflow.length === 0 ? '字幕语速正常' : `越界分镜段：${overflow.map((s) => s.orderNo).join('、')}`,
    },
  ]
  await prisma.qcReport.createMany({ data: checks.map((c) => ({ taskId, ...c })) })

  if (checks.some((c) => c.result === 'fail')) {
    await transitionTask(taskId, 'QC_FAILED', checks.filter((c) => c.result === 'fail').map((c) => c.checkType).join(', ') + ' 未通过')
    return
  }
  await transitionTask(taskId, 'QC_PASSED', '三项质检全部通过')

  // 生成导出产物
  await fs.copyFile(draft, path.join(outDir, 'final.mp4'))
  const project = {
    taskId,
    scriptTitle: task.script?.title,
    aspectRatio: task.aspectRatio,
    segments: task.segments.map((s) => ({
      orderNo: s.orderNo,
      subtitleText: s.subtitleText,
      startMs: s.startMs,
      endMs: s.endMs,
      materialFile: s.material?.fileUrl,
    })),
  }
  await fs.writeFile(path.join(outDir, 'project.json'), JSON.stringify(project, null, 2))
  const base = `/api/files/exports/${taskId}`
  await prisma.export.create({
    data: {
      taskId,
      videoUrl: `${base}/final.mp4`,
      subtitleUrl: `${base}/subtitle.srt`,
      projectJsonUrl: `${base}/project.json`,
    },
  })
  await transitionTask(taskId, 'EXPORTED', '导出完成')
}
```

- [ ] **Step 3: 接入 dispatch**

`worker/src/index.ts`:
```ts
import { runQc } from './jobs/runQc'
```
switch 中替换：
```ts
    case 'run-qc': return runQc(taskId)
```

- [ ] **Step 4: 集成验证（确认预览 → 质检 → 导出）**

Run:
```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml restart worker
curl -s -b /tmp/cs.txt -X POST http://localhost:3000/api/tasks/$TID/confirm-preview
sleep 20
curl -s -b /tmp/cs.txt http://localhost:3000/api/tasks/$TID | python3 -c 'import json,sys;d=json.load(sys.stdin);print(d["status"]);[print(r["checkType"],r["result"]) for r in d["qcReports"][:3]]'
curl -s -b /tmp/cs.txt http://localhost:3000/api/tasks/$TID/export
```
Expected: 状态 `EXPORTED`；三项 `pass`；export 返回三个 URL；三个 URL 均可下载（final.mp4 可播放、subtitle.srt 为中文 SRT、project.json 含分镜数组）。

- [ ] **Step 5: Commit**

```bash
git add worker
git commit -m "feat: 三项自动质检与成片导出（MP4/SRT/项目 JSON）"
```

---

### Task 13: 学员端页面（登录/首页/作品列表/作品详情）

**Files:**
- Create: `web/lib/status.ts`、`web/app/(student)/layout.tsx`、`web/app/(student)/login/page.tsx`、`web/app/(student)/works/page.tsx`、`web/app/(student)/works/[id]/page.tsx`
- Modify: `web/app/(student)/page.tsx`（替换占位）

**Interfaces:**
- Consumes: `api`、任务/文案/导出 HTTP API（Task 8/9）
- Produces:
  - `web/lib/status.ts`:
    - `STATUS_LABELS: Record<string, string>`（全部 13 个状态的中文名）
    - `statusGroup(status: string): '已完成' | '失败' | '处理中'`（EXPORTED→已完成；FAILED→失败；其余→处理中）
    - `isTerminal(status: string): boolean`（EXPORTED/FAILED/MATERIAL_PENDING/PREVIEW_PENDING/QC_FAILED 视为"停下等人"，用于停止轮询）
  - 页面路由：`/login`、`/`、`/works`、`/works/[id]`（均移动优先）

- [ ] **Step 1: 状态工具**

`web/lib/status.ts`:
```ts
export const STATUS_LABELS: Record<string, string> = {
  CREATED: '已创建',
  SEGMENTING: '脚本分段中',
  MATCHING: '素材匹配中',
  MATERIAL_PENDING: '等待运营补充素材',
  STORYBOARD_READY: '分镜就绪',
  RENDERING: '视频渲染中',
  PREVIEW_PENDING: '待预览确认',
  REVISING: '修改中',
  QC_RUNNING: '质检中',
  QC_PASSED: '质检通过',
  QC_FAILED: '质检未通过',
  EXPORTED: '已完成',
  FAILED: '生成失败',
}

export function statusGroup(status: string): '已完成' | '失败' | '处理中' {
  if (status === 'EXPORTED') return '已完成'
  if (status === 'FAILED') return '失败'
  return '处理中'
}

export function isTerminal(status: string): boolean {
  return ['EXPORTED', 'FAILED', 'MATERIAL_PENDING', 'PREVIEW_PENDING', 'QC_FAILED'].includes(status)
}
```

- [ ] **Step 2: 学员端布局与登录页**

`web/app/(student)/layout.tsx`:
```tsx
import Link from 'next/link'

export default function StudentLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto flex min-h-dvh max-w-lg flex-col">
      <main className="flex-1 p-4 pb-20">{children}</main>
      <nav className="fixed inset-x-0 bottom-0 z-10 mx-auto flex max-w-lg border-t bg-white pb-[env(safe-area-inset-bottom)]">
        <Link href="/" className="flex-1 py-3 text-center text-sm">首页</Link>
        <Link href="/works" className="flex-1 py-3 text-center text-sm">我的作品</Link>
      </nav>
    </div>
  )
}
```

`web/app/(student)/login/page.tsx`:
```tsx
'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { api } from '@/lib/fetcher'

export default function LoginPage() {
  const router = useRouter()
  const [mode, setMode] = useState<'account' | 'key'>('account')
  const [account, setAccount] = useState('')
  const [password, setPassword] = useState('')
  const [key, setKey] = useState('')
  const [err, setErr] = useState('')
  const [loading, setLoading] = useState(false)

  async function login() {
    setErr(''); setLoading(true)
    try {
      const res = await api<{ role: string }>('/api/auth/login', {
        body: mode === 'key' ? { key } : { account, password },
      })
      router.replace(res.role === 'operator' ? '/admin/tasks' : '/')
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-4 p-6">
      <h1 className="text-center text-xl font-bold">投流素材混剪工具</h1>
      <div className="flex rounded-lg border p-1 text-sm">
        <button onClick={() => setMode('account')}
          className={`flex-1 rounded-md py-2 ${mode === 'account' ? 'bg-blue-600 text-white' : ''}`}>账号登录</button>
        <button onClick={() => setMode('key')}
          className={`flex-1 rounded-md py-2 ${mode === 'key' ? 'bg-blue-600 text-white' : ''}`}>密钥登录</button>
      </div>
      {mode === 'account' ? (
        <>
          <input value={account} onChange={(e) => setAccount(e.target.value)} placeholder="账号"
            className="rounded-lg border px-3 py-3" autoCapitalize="none" />
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="密码"
            className="rounded-lg border px-3 py-3" />
        </>
      ) : (
        <input value={key} onChange={(e) => setKey(e.target.value)} placeholder="访问密钥"
          className="rounded-lg border px-3 py-3" autoCapitalize="none" />
      )}
      {err && <p className="text-sm text-red-600">{err}</p>}
      <button onClick={login} disabled={loading}
        className="rounded-lg bg-blue-600 py-3 text-white disabled:opacity-50">
        {loading ? '登录中…' : '登录'}
      </button>
    </div>
  )
}
```

- [ ] **Step 3: 首页（选文案包 + 规格 + 一键生成 + 最近作品）**

`web/app/(student)/page.tsx`（整体替换）:
```tsx
'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { api } from '@/lib/fetcher'
import { STATUS_LABELS } from '@/lib/status'

type Script = { id: string; title: string; _count: { segments: number } }
type Task = { id: string; status: string; createdAt: string; script: { title: string } | null }

export default function HomePage() {
  const router = useRouter()
  const [scripts, setScripts] = useState<Script[]>([])
  const [recent, setRecent] = useState<Task[]>([])
  const [selected, setSelected] = useState('')
  const [ratio, setRatio] = useState<'9:16' | '16:9'>('9:16')
  const [err, setErr] = useState('')
  const [creating, setCreating] = useState(false)

  useEffect(() => {
    api<Script[]>('/api/scripts').then(setScripts)
    api<Task[]>('/api/tasks').then((t) => setRecent(t.slice(0, 3)))
  }, [])

  async function create() {
    setErr(''); setCreating(true)
    try {
      const task = await api<{ id: string }>('/api/tasks', { body: { scriptId: selected, aspectRatio: ratio } })
      router.push(`/works/${task.id}`)
    } catch (e) {
      setErr((e as Error).message); setCreating(false)
    }
  }

  return (
    <div className="space-y-5">
      <h1 className="text-xl font-bold">快速开始</h1>
      {err && <p className="rounded bg-red-50 p-2 text-sm text-red-600">{err}</p>}
      <section className="space-y-2">
        <h2 className="text-sm text-gray-500">1. 选择文案包</h2>
        {scripts.map((s) => (
          <button key={s.id} onClick={() => setSelected(s.id)}
            className={`block w-full rounded-xl border p-4 text-left ${selected === s.id ? 'border-blue-600 bg-blue-50' : 'bg-white'}`}>
            <p className="font-medium">{s.title}</p>
            <p className="text-xs text-gray-400">{s._count.segments} 个分镜段</p>
          </button>
        ))}
        {scripts.length === 0 && <p className="text-sm text-gray-400">暂无已发布的文案包</p>}
      </section>
      <section className="space-y-2">
        <h2 className="text-sm text-gray-500">2. 选择输出规格</h2>
        <div className="flex gap-2">
          {(['9:16', '16:9'] as const).map((r) => (
            <button key={r} onClick={() => setRatio(r)}
              className={`flex-1 rounded-xl border py-3 ${ratio === r ? 'border-blue-600 bg-blue-50' : 'bg-white'}`}>
              {r === '9:16' ? '竖屏 9:16' : '横屏 16:9'}
            </button>
          ))}
        </div>
      </section>
      <button onClick={create} disabled={!selected || creating}
        className="w-full rounded-xl bg-blue-600 py-3 text-lg text-white disabled:opacity-40">
        {creating ? '创建中…' : '一键生成'}
      </button>
      <section className="space-y-2">
        <h2 className="text-sm text-gray-500">最近作品</h2>
        {recent.map((t) => (
          <Link key={t.id} href={`/works/${t.id}`}
            className="flex items-center justify-between rounded-xl border bg-white p-3">
            <span className="text-sm">{t.script?.title ?? '未知文案'}</span>
            <span className="text-xs text-gray-400">{STATUS_LABELS[t.status] ?? t.status}</span>
          </Link>
        ))}
      </section>
    </div>
  )
}
```

- [ ] **Step 4: 作品列表（四个 tab）**

`web/app/(student)/works/page.tsx`:
```tsx
'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { api } from '@/lib/fetcher'
import { STATUS_LABELS, statusGroup } from '@/lib/status'

type Task = { id: string; status: string; createdAt: string; script: { title: string } | null }
const TABS = ['全部', '已完成', '处理中', '失败'] as const

export default function WorksPage() {
  const [tasks, setTasks] = useState<Task[]>([])
  const [tab, setTab] = useState<(typeof TABS)[number]>('全部')

  useEffect(() => { api<Task[]>('/api/tasks').then(setTasks) }, [])
  const shown = tasks.filter((t) => tab === '全部' || statusGroup(t.status) === tab)

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">我的作品</h1>
      <div className="flex gap-1 rounded-lg border bg-white p-1 text-sm">
        {TABS.map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className={`flex-1 rounded-md py-2 ${tab === t ? 'bg-blue-600 text-white' : ''}`}>{t}</button>
        ))}
      </div>
      <ul className="space-y-2">
        {shown.map((t) => (
          <li key={t.id}>
            <Link href={`/works/${t.id}`} className="flex items-center justify-between rounded-xl border bg-white p-4">
              <div>
                <p className="font-medium">{t.script?.title ?? '未知文案'}</p>
                <p className="text-xs text-gray-400">{new Date(t.createdAt).toLocaleString('zh-CN')}</p>
              </div>
              <span className={`rounded-full px-2 py-1 text-xs ${
                statusGroup(t.status) === '已完成' ? 'bg-green-100 text-green-700'
                : statusGroup(t.status) === '失败' ? 'bg-red-100 text-red-600'
                : 'bg-blue-100 text-blue-600'}`}>
                {STATUS_LABELS[t.status] ?? t.status}
              </span>
            </Link>
          </li>
        ))}
        {shown.length === 0 && <p className="py-8 text-center text-sm text-gray-400">暂无作品</p>}
      </ul>
    </div>
  )
}
```

- [ ] **Step 5: 作品详情（轮询 + 播放器 + 确认/下载/重试）**

`web/app/(student)/works/[id]/page.tsx`:
```tsx
'use client'
import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { api } from '@/lib/fetcher'
import { STATUS_LABELS, isTerminal } from '@/lib/status'

type Task = {
  id: string; status: string; aspectRatio: string
  script: { title: string } | null
  statusLogs: { id: string; toStatus: string; note: string | null; createdAt: string }[]
  exports: { videoUrl: string; subtitleUrl: string; projectJsonUrl: string }[]
}

export default function WorkDetailPage() {
  const { id } = useParams<{ id: string }>()
  const [task, setTask] = useState<Task | null>(null)
  const [err, setErr] = useState('')

  const load = useCallback(async () => {
    const t = await api<Task>(`/api/tasks/${id}`)
    setTask(t)
    return t
  }, [id])

  useEffect(() => {
    load()
    const timer = setInterval(async () => {
      const t = await load()
      if (isTerminal(t.status)) clearInterval(timer)
    }, 3000)
    return () => clearInterval(timer)
  }, [load])

  async function act(path: string) {
    setErr('')
    try { await api(`/api/tasks/${id}/${path}`, { method: 'POST' }); await load() }
    catch (e) { setErr((e as Error).message) }
  }

  if (!task) return <p className="p-4">加载中…</p>
  const exp = task.exports[0]
  const showDraft = ['PREVIEW_PENDING', 'QC_RUNNING', 'QC_PASSED', 'QC_FAILED'].includes(task.status)

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-bold">{task.script?.title ?? '作品详情'}</h1>
      {err && <p className="rounded bg-red-50 p-2 text-sm text-red-600">{err}</p>}
      <p className="text-sm">
        状态：<span className="font-medium text-blue-600">{STATUS_LABELS[task.status] ?? task.status}</span>
        <span className="ml-2 text-xs text-gray-400">{task.aspectRatio === '9:16' ? '竖屏' : '横屏'}</span>
      </p>
      {(showDraft || task.status === 'EXPORTED') && (
        <video controls playsInline className="w-full rounded-xl bg-black"
          src={task.status === 'EXPORTED' && exp ? exp.videoUrl : `/api/files/exports/${task.id}/draft.mp4`} />
      )}
      {task.status === 'PREVIEW_PENDING' && (
        <button onClick={() => act('confirm-preview')}
          className="w-full rounded-xl bg-green-600 py-3 text-white">确认无误，提交质检</button>
      )}
      {task.status === 'FAILED' && (
        <button onClick={() => act('retry')}
          className="w-full rounded-xl bg-orange-500 py-3 text-white">失败重试</button>
      )}
      {task.status === 'EXPORTED' && exp && (
        <div className="space-y-2">
          <a href={exp.videoUrl} download className="block rounded-xl bg-blue-600 py-3 text-center text-white">下载成片 MP4</a>
          <div className="flex gap-2 text-sm">
            <a href={exp.subtitleUrl} download className="flex-1 rounded-lg border bg-white py-2 text-center">字幕 SRT</a>
            <a href={exp.projectJsonUrl} download className="flex-1 rounded-lg border bg-white py-2 text-center">项目 JSON</a>
          </div>
        </div>
      )}
      <section>
        <h2 className="mb-2 text-sm text-gray-500">处理进度</h2>
        <ul className="space-y-1 rounded-xl border bg-white p-3 text-sm">
          {task.statusLogs.map((l) => (
            <li key={l.id} className="flex justify-between">
              <span>{STATUS_LABELS[l.toStatus] ?? l.toStatus}{l.note ? `（${l.note}）` : ''}</span>
              <span className="text-xs text-gray-400">{new Date(l.createdAt).toLocaleTimeString('zh-CN')}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}
```

- [ ] **Step 6: 验证**

浏览器（375px 视口）用 `tmpstu` 登录：首页选文案 → 选竖屏 → 一键生成 → 自动跳转作品详情，观察状态轮询推进到"待预览确认" → 播放初稿 → 确认提交质检 → 变为"已完成" → 三个下载按钮可用。`/works` 四个 tab 过滤正确。
Expected: 全流程无 JS 报错（DevTools Console 干净），视频在移动视口内正常播放。

- [ ] **Step 7: Commit**

```bash
git add web
git commit -m "feat: 学员端页面（登录/首页/作品列表/作品详情，移动优先）"
```

---

### Task 14: 运营任务页（列表 + 分镜编辑详情页）

**Files:**
- Create: `web/app/admin/tasks/page.tsx`、`web/app/admin/tasks/[id]/page.tsx`、`web/components/BottomSheet.tsx`

**Interfaces:**
- Consumes: `api`、`STATUS_LABELS`/`statusGroup`/`isTerminal`、任务 API（Task 9）、素材 API（Task 7）
- Produces:
  - `web/components/BottomSheet.tsx`: `<BottomSheet open onClose title>{children}</BottomSheet>` — 移动端底部抽屉（backdrop + 圆角面板 + max-h-70vh 滚动）
  - 页面：`/admin/tasks`（状态筛选列表）、`/admin/tasks/[id]`（分镜卡片编辑：换素材/改字幕/上下移，素材不足段高亮 + 「去素材库上传」跳转 `?returnTaskId=`，link-material 关联、QC 报告、确认预览、重新质检）

- [ ] **Step 1: BottomSheet 组件**

`web/components/BottomSheet.tsx`:
```tsx
'use client'

export default function BottomSheet({
  open, onClose, title, children,
}: { open: boolean; onClose: () => void; title: string; children: React.ReactNode }) {
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="absolute inset-x-0 bottom-0 max-h-[70vh] overflow-auto rounded-t-2xl bg-white p-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="font-semibold">{title}</h3>
          <button onClick={onClose} className="px-2 text-gray-400">关闭</button>
        </div>
        {children}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: 任务列表页**

`web/app/admin/tasks/page.tsx`:
```tsx
'use client'
import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { api } from '@/lib/fetcher'
import { STATUS_LABELS } from '@/lib/status'

type Task = { id: string; status: string; createdAt: string; script: { title: string } | null }
const FILTERS = ['', 'MATERIAL_PENDING', 'PREVIEW_PENDING', 'QC_FAILED', 'FAILED', 'EXPORTED']

export default function AdminTasksPage() {
  const [tasks, setTasks] = useState<Task[]>([])
  const [filter, setFilter] = useState('')

  const load = useCallback(async () =>
    setTasks(await api<Task[]>(`/api/tasks${filter ? `?status=${filter}` : ''}`)), [filter])
  useEffect(() => { load() }, [load])

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold">任务队列</h1>
      <div className="flex gap-2 overflow-x-auto pb-1">
        {FILTERS.map((f) => (
          <button key={f} onClick={() => setFilter(f)}
            className={`shrink-0 rounded-full border px-3 py-1 text-sm ${filter === f ? 'border-blue-600 bg-blue-50 text-blue-600' : 'bg-white'}`}>
            {f === '' ? '全部' : STATUS_LABELS[f]}
          </button>
        ))}
      </div>
      <ul className="space-y-2">
        {tasks.map((t) => (
          <li key={t.id}>
            <Link href={`/admin/tasks/${t.id}`} className="flex items-center justify-between rounded-xl border bg-white p-3">
              <div>
                <p className="text-sm font-medium">{t.script?.title ?? '未知文案'}</p>
                <p className="text-xs text-gray-400">{new Date(t.createdAt).toLocaleString('zh-CN')}</p>
              </div>
              <span className="text-xs text-blue-600">{STATUS_LABELS[t.status] ?? t.status}</span>
            </Link>
          </li>
        ))}
        {tasks.length === 0 && <p className="py-8 text-center text-sm text-gray-400">暂无任务</p>}
      </ul>
    </div>
  )
}
```

- [ ] **Step 3: 任务详情页（分镜编辑器）**

`web/app/admin/tasks/[id]/page.tsx`:
```tsx
'use client'
import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { api } from '@/lib/fetcher'
import { STATUS_LABELS, isTerminal } from '@/lib/status'
import BottomSheet from '@/components/BottomSheet'

type Seg = {
  id: string; orderNo: number; startMs: number; endMs: number | null
  subtitleText: string | null; materialId: string | null
  material: { id: string; fileUrl: string; thumbnailUrl: string | null } | null
  segment: { text: string; tags: { tagId: string }[] } | null
}
type Task = {
  id: string; status: string; aspectRatio: string
  script: { title: string } | null
  segments: Seg[]
  qcReports: { id: string; checkType: string; result: string; detail: string | null }[]
  statusLogs: { id: string; toStatus: string; note: string | null; createdAt: string }[]
  exports: { videoUrl: string }[]
}
type Material = { id: string; thumbnailUrl: string | null; durationMs: number | null; tags: { tagId: string }[] }

const QC_NAMES: Record<string, string> = {
  black_frame: '黑屏检测', silence: '静音检测', subtitle_overflow: '字幕越界',
}

export default function AdminTaskDetailPage() {
  const { id } = useParams<{ id: string }>()
  const [task, setTask] = useState<Task | null>(null)
  const [subs, setSubs] = useState<Record<string, string>>({})
  const [mats, setMats] = useState<Record<string, string>>({})
  const [order, setOrder] = useState<string[]>([])
  const [picking, setPicking] = useState<Seg | null>(null)
  const [allMaterials, setAllMaterials] = useState<Material[]>([])
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    const t = await api<Task>(`/api/tasks/${id}`)
    setTask(t)
    setOrder(t.segments.map((s) => s.id))
    return t
  }, [id])

  useEffect(() => {
    load()
    const timer = setInterval(async () => {
      const t = await load()
      if (isTerminal(t.status)) clearInterval(timer)
    }, 3000)
    return () => clearInterval(timer)
  }, [load])

  useEffect(() => { api<Material[]>('/api/materials').then(setAllMaterials) }, [])

  async function act(fn: () => Promise<unknown>) {
    setErr(''); setBusy(true)
    try { await fn(); await load() } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }

  function move(segId: string, dir: -1 | 1) {
    setOrder((o) => {
      const i = o.indexOf(segId)
      const j = i + dir
      if (j < 0 || j >= o.length) return o
      const next = [...o]
      ;[next[i], next[j]] = [next[j], next[i]]
      return next
    })
  }

  function saveRevise() {
    if (!task) return
    const changes = task.segments
      .filter((s) => subs[s.id] !== undefined || mats[s.id] !== undefined)
      .map((s) => ({
        taskSegmentId: s.id,
        ...(subs[s.id] !== undefined ? { subtitleText: subs[s.id] } : {}),
        ...(mats[s.id] !== undefined ? { materialId: mats[s.id] } : {}),
      }))
    const orderChanged = order.some((sid, i) => task.segments[i]?.id !== sid)
    act(() => api(`/api/tasks/${id}/revise`, {
      body: { changes, ...(orderChanged ? { order } : {}) },
    })).then(() => { setSubs({}); setMats({}) })
  }

  function linkMaterial(seg: Seg, materialId: string) {
    act(() => api(`/api/tasks/${id}/segments/${seg.id}/link-material`, { body: { materialId } }))
    setPicking(null)
  }

  if (!task) return <p>加载中…</p>
  const editable = task.status === 'PREVIEW_PENDING' || task.status === 'QC_FAILED'
  const pending = task.status === 'MATERIAL_PENDING'
  const segMap = new Map(task.segments.map((s) => [s.id, s]))
  const orderedSegs = order.map((sid) => segMap.get(sid)!).filter(Boolean)
  const dirty = Object.keys(subs).length + Object.keys(mats).length > 0
    || order.some((sid, i) => task.segments[i]?.id !== sid)

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold">{task.script?.title ?? '任务详情'}</h1>
      {err && <p className="rounded bg-red-50 p-2 text-sm text-red-600">{err}</p>}
      <p className="text-sm">状态：<span className="font-medium text-blue-600">{STATUS_LABELS[task.status] ?? task.status}</span></p>

      {['PREVIEW_PENDING', 'QC_RUNNING', 'QC_PASSED', 'QC_FAILED', 'EXPORTED'].includes(task.status) && (
        <video controls playsInline className="w-full rounded-xl bg-black"
          src={task.status === 'EXPORTED' && task.exports[0] ? task.exports[0].videoUrl : `/api/files/exports/${task.id}/draft.mp4`} />
      )}

      {pending && (
        <Link href={`/admin/materials?returnTaskId=${task.id}`}
          className="block rounded-xl bg-amber-500 py-3 text-center text-white">
          素材不足 → 去素材库上传
        </Link>
      )}

      <section className="space-y-3">
        <h2 className="text-sm text-gray-500">分镜（{orderedSegs.length} 段）</h2>
        {orderedSegs.map((seg, i) => {
          const missing = !seg.materialId && !mats[seg.id]
          const mat = mats[seg.id]
            ? allMaterials.find((m) => m.id === mats[seg.id])
            : seg.material
          return (
            <div key={seg.id}
              className={`rounded-xl border bg-white p-3 ${missing && pending ? 'border-amber-400 bg-amber-50' : ''}`}>
              <div className="flex gap-3">
                {mat && 'thumbnailUrl' in mat && mat.thumbnailUrl
                  ? <img src={mat.thumbnailUrl} alt="" className="h-16 w-24 rounded object-cover" />
                  : <div className="flex h-16 w-24 items-center justify-center rounded bg-gray-100 text-xs text-gray-400">无素材</div>}
                <div className="flex-1">
                  <p className="text-xs text-gray-400">#{i + 1}</p>
                  {editable ? (
                    <textarea rows={2} defaultValue={seg.subtitleText ?? ''}
                      onChange={(e) => setSubs((s) => ({ ...s, [seg.id]: e.target.value }))}
                      className="w-full rounded border px-2 py-1 text-sm" />
                  ) : (
                    <p className="text-sm">{seg.subtitleText}</p>
                  )}
                </div>
              </div>
              <div className="mt-2 flex gap-2 text-sm">
                {(editable || pending) && (
                  <button onClick={() => setPicking(seg)} className="rounded-lg border px-3 py-1">
                    {pending ? '关联素材' : '换素材'}
                  </button>
                )}
                {editable && (
                  <>
                    <button onClick={() => move(seg.id, -1)} className="rounded-lg border px-3 py-1">上移</button>
                    <button onClick={() => move(seg.id, 1)} className="rounded-lg border px-3 py-1">下移</button>
                  </>
                )}
              </div>
            </div>
          )
        })}
      </section>

      {editable && (
        <div className="space-y-2">
          <button onClick={saveRevise} disabled={!dirty || busy}
            className="w-full rounded-xl bg-blue-600 py-3 text-white disabled:opacity-40">
            保存修改并重新渲染
          </button>
          {task.status === 'PREVIEW_PENDING' && (
            <button onClick={() => act(() => api(`/api/tasks/${id}/confirm-preview`, { method: 'POST' }))}
              disabled={busy || dirty}
              className="w-full rounded-xl bg-green-600 py-3 text-white disabled:opacity-40">
              确认无误，提交质检
            </button>
          )}
          {task.status === 'QC_FAILED' && (
            <button onClick={() => act(() => api(`/api/tasks/${id}/retry-qc`, { method: 'POST' }))}
              disabled={busy || dirty}
              className="w-full rounded-xl bg-orange-500 py-3 text-white disabled:opacity-40">
              直接重新质检
            </button>
          )}
        </div>
      )}

      {task.qcReports.length > 0 && (
        <section>
          <h2 className="mb-2 text-sm text-gray-500">质检报告（最近一轮）</h2>
          <ul className="space-y-1 rounded-xl border bg-white p-3 text-sm">
            {task.qcReports.slice(0, 3).map((r) => (
              <li key={r.id} className="flex justify-between">
                <span>{QC_NAMES[r.checkType] ?? r.checkType}</span>
                <span className={r.result === 'pass' ? 'text-green-600' : 'text-red-500'}>
                  {r.result === 'pass' ? '通过' : `不通过：${r.detail ?? ''}`}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <h2 className="mb-2 text-sm text-gray-500">状态日志</h2>
        <ul className="space-y-1 rounded-xl border bg-white p-3 text-xs text-gray-600">
          {task.statusLogs.map((l) => (
            <li key={l.id}>{new Date(l.createdAt).toLocaleTimeString('zh-CN')} → {STATUS_LABELS[l.toStatus] ?? l.toStatus}{l.note ? `（${l.note}）` : ''}</li>
          ))}
        </ul>
      </section>

      <BottomSheet open={!!picking} onClose={() => setPicking(null)} title="选择素材">
        <ul className="grid grid-cols-3 gap-2">
          {allMaterials
            .slice()
            .sort((a, b) => {
              const tags = new Set((picking?.segment?.tags ?? []).map((t) => t.tagId))
              const sa = a.tags.filter((t) => tags.has(t.tagId)).length
              const sb = b.tags.filter((t) => tags.has(t.tagId)).length
              return sb - sa
            })
            .map((m) => (
              <button key={m.id} onClick={() => {
                if (!picking) return
                if (pending) linkMaterial(picking, m.id)
                else { setMats((s) => ({ ...s, [picking.id]: m.id })); setPicking(null) }
              }} className="overflow-hidden rounded-lg border">
                {m.thumbnailUrl && <img src={m.thumbnailUrl} alt="" className="aspect-video w-full object-cover" />}
                <p className="p-1 text-center text-xs text-gray-500">{((m.durationMs ?? 0) / 1000).toFixed(1)}s</p>
              </button>
            ))}
        </ul>
      </BottomSheet>
    </div>
  )
}
```

- [ ] **Step 4: 验证**

浏览器（375px）用 `tmpop` 登录 `/admin/tasks`：
- 筛选 chips 可横向滚动、点选过滤。
- 打开一个 `PREVIEW_PENDING` 任务：改一段字幕 → 上移一段 → 换一个素材（底部抽屉，按标签匹配度排序）→「保存修改并重新渲染」→ 状态回到渲染中 → 轮询回到待预览，播放确认改动生效。
- 制造 `MATERIAL_PENDING` 任务：缺素材段黄色高亮，「去素材库上传」跳转带 `returnTaskId`，上传后经返回入口回来，「关联素材」抽屉选中后任务自动推进。
Expected: 全流程可用、无 Console 报错。

- [ ] **Step 5: Commit**

```bash
git add web
git commit -m "feat: 运营任务队列与分镜编辑详情页（底部抽屉选素材/按钮调序）"
```

---

### Task 15: Seed 脚本 + 测试素材生成

**Files:**
- Create: `worker/src/seed.ts`

**Interfaces:**
- Consumes: `prisma`、`splitScript`、fluent-ffmpeg
- Produces: `docker compose ... exec worker npm run seed` 一键灌入：
  - 账号：`operator/op123456`（运营）、`student/stu123456`（学员）、学员密钥 `DEMO-KEY-2026`
  - 标签树：开发文档第 4 节结构（场景/人物/产品类型/情绪基调 四棵，共 10 个叶子）
  - 素材：12 条 FFmpeg 生成测试视频（6 横 6 竖、彩色底+编号水印+音频音调），每条挂 2-3 个叶子标签
  - 文案：《育儿好物推荐》（published，4 段，每段已挂能匹配到素材的标签）、《神秘小说安利》（published，3 段，其中 1 段挂"小说类"标签但**故意不给任何素材挂"小说类"**→ 用于验证 MATERIAL_PENDING 流程）

- [ ] **Step 1: seed 脚本**

`worker/src/seed.ts`:
```ts
import path from 'path'
import fs from 'fs/promises'
import ffmpeg from 'fluent-ffmpeg'
import bcrypt from 'bcryptjs'
import { prisma, splitScript } from '@mixcut/db'
import { DATA_DIR } from './paths'

async function genVideo(out: string, opts: { color: string; label: string; w: number; h: number; freq: number }) {
  const { color, label, w, h, freq } = opts
  await new Promise<void>((resolve, reject) => {
    ffmpeg()
      .input(`color=c=${color}:s=${w}x${h}:d=6`).inputFormat('lavfi')
      .input(`sine=frequency=${freq}:duration=6`).inputFormat('lavfi')
      .outputOptions([
        '-vf', `drawtext=text='${label}':font='Noto Sans CJK SC':fontsize=${Math.round(h / 8)}:fontcolor=white:x=(w-text_w)/2:y=(h-text_h)/2`,
        '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p',
        '-c:a', 'aac', '-ar', '44100',
      ])
      .output(out)
      .on('end', () => resolve())
      .on('error', reject)
      .run()
  })
}

async function makeThumb(video: string, outJpg: string) {
  await new Promise<void>((resolve, reject) => {
    ffmpeg(video).inputOptions(['-ss', '0.5'])
      .outputOptions(['-frames:v', '1', '-vf', 'scale=320:-2'])
      .output(outJpg).on('end', () => resolve()).on('error', reject).run()
  })
}

async function main() {
  // 1. 用户与密钥
  const [op, stu] = await Promise.all([
    prisma.user.upsert({
      where: { account: 'operator' }, update: {},
      create: { account: 'operator', passwordHash: bcrypt.hashSync('op123456', 10), role: 'operator' },
    }),
    prisma.user.upsert({
      where: { account: 'student' }, update: {},
      create: { account: 'student', passwordHash: bcrypt.hashSync('stu123456', 10), role: 'student' },
    }),
  ])
  await prisma.accessKey.upsert({
    where: { keyValue: 'DEMO-KEY-2026' }, update: {},
    create: { keyValue: 'DEMO-KEY-2026', userId: stu.id },
  })

  // 2. 标签树（幂等：已存在则跳过）
  if ((await prisma.tagCategory.count()) === 0) {
    const tree: Record<string, string[]> = {
      场景: ['书房/阅读角', '户外', '产品特写'],
      人物: ['讲解人出镜', '无人出镜'],
      产品类型: ['育儿类', '养生类', '小说类'],
      情绪基调: ['自然口播', '情绪煽动'],
    }
    for (const [root, children] of Object.entries(tree)) {
      const parent = await prisma.tagCategory.create({ data: { name: root } })
      for (const [i, name] of children.entries()) {
        await prisma.tagCategory.create({ data: { name, parentId: parent.id, sortOrder: i + 1 } })
      }
    }
  }
  const leaf = async (name: string) =>
    (await prisma.tagCategory.findFirstOrThrow({ where: { name, parentId: { not: null } } })).id

  // 3. 测试素材（12 条；注意：不给"小说类"挂任何素材，用于验证 MATERIAL_PENDING）
  if ((await prisma.material.count()) === 0) {
    const colors = ['0x8E44AD', '0x2980B9', '0x27AE60', '0xD35400', '0xC0392B', '0x16A085']
    const specs: { tags: string[] }[] = [
      { tags: ['书房/阅读角', '育儿类', '自然口播'] },
      { tags: ['书房/阅读角', '养生类'] },
      { tags: ['户外', '育儿类', '情绪煽动'] },
      { tags: ['户外', '养生类', '自然口播'] },
      { tags: ['产品特写', '育儿类'] },
      { tags: ['产品特写', '养生类', '情绪煽动'] },
      { tags: ['讲解人出镜', '育儿类', '自然口播'] },
      { tags: ['讲解人出镜', '养生类'] },
      { tags: ['无人出镜', '产品特写', '育儿类'] },
      { tags: ['无人出镜', '户外'] },
      { tags: ['书房/阅读角', '讲解人出镜', '情绪煽动'] },
      { tags: ['产品特写', '无人出镜', '自然口播'] },
    ]
    await fs.mkdir(path.join(DATA_DIR, 'materials'), { recursive: true })
    for (const [i, spec] of specs.entries()) {
      const vertical = i % 2 === 0
      const name = `seed-${String(i + 1).padStart(2, '0')}`
      const abs = path.join(DATA_DIR, 'materials', `${name}.mp4`)
      await genVideo(abs, {
        color: colors[i % colors.length],
        label: `素材${i + 1}`,
        w: vertical ? 720 : 1280,
        h: vertical ? 1280 : 720,
        freq: 300 + i * 40,
      })
      await makeThumb(abs, path.join(DATA_DIR, 'materials', `${name}.jpg`))
      const tagIds = await Promise.all(spec.tags.map(leaf))
      await prisma.material.create({
        data: {
          fileUrl: `/api/files/materials/${name}.mp4`,
          thumbnailUrl: `/api/files/materials/${name}.jpg`,
          durationMs: 6000,
          uploadedBy: op.id,
          tags: { create: tagIds.map((tagId) => ({ tagId })) },
        },
      })
      console.log(`[seed] material ${name} 生成完毕`)
    }
  }

  // 4. 示例文案（分段 + 打标签 + 发布）
  if ((await prisma.script.count()) === 0) {
    const scripts: { title: string; content: string; segTags: string[][] }[] = [
      {
        title: '育儿好物推荐',
        content: '当妈妈之后才知道，选对绘本有多重要\n这套书我家娃反复翻了一个月都不腻\n画面精美内容也有深度，性价比真的高\n现在下单还有活动价，链接就在下方',
        segTags: [
          ['讲解人出镜', '育儿类', '自然口播'],
          ['书房/阅读角', '育儿类'],
          ['产品特写', '育儿类'],
          ['产品特写', '育儿类', '情绪煽动'],
        ],
      },
      {
        title: '神秘小说安利',
        content: '这本悬疑小说我一口气读到凌晨三点\n反转多到你根本猜不到结局\n喜欢烧脑的书友千万别错过',
        segTags: [
          ['书房/阅读角', '小说类'],
          ['小说类', '情绪煽动'],
          ['产品特写', '小说类'],
        ],
      },
    ]
    for (const s of scripts) {
      const script = await prisma.script.create({
        data: { title: s.title, content: s.content, status: 'published', createdBy: op.id },
      })
      const parts = splitScript(s.content)
      for (const [i, text] of parts.entries()) {
        const seg = await prisma.scriptSegment.create({
          data: { scriptId: script.id, seqNo: i + 1, text },
        })
        const tagIds = await Promise.all((s.segTags[i] ?? []).map(leaf))
        await prisma.segmentTag.createMany({
          data: tagIds.map((tagId) => ({ segmentId: seg.id, tagId })),
        })
      }
      console.log(`[seed] script 《${s.title}》 完成`)
    }
  }

  console.log('[seed] 全部完成')
}

main().finally(() => prisma.$disconnect())
```

- [ ] **Step 2: 清库重灌验证**

Run:
```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml exec web npx prisma migrate reset --force --schema packages/db/prisma/schema.prisma
rm -rf data/materials/* data/exports/*
docker compose -f docker-compose.yml -f docker-compose.dev.yml exec worker npm run seed
```
Expected: 日志依次输出 12 条素材与 2 篇文案完成；`ls data/materials | wc -l` 为 24（12 mp4 + 12 jpg）。再跑一次 seed 不重复插入（幂等）。

- [ ] **Step 3: Commit**

```bash
git add worker
git commit -m "feat: seed 脚本（账号/标签树/12条测试素材/2篇示例文案）"
```

---

### Task 16: 本地 Docker 全链路验收（含生产构建）

**Files:**
- Create: `README.md`（启动/账号/常用命令说明）

**Interfaces:**
- Consumes: 前面全部任务
- Produces: 验收通过的本地部署 + README；这是"上传服务器"前的最后一关

- [ ] **Step 1: README**

`README.md`:
```markdown
# 投流素材混剪工具（MVP）

## 本地启动（开发模式）
```bash
cp .env.example .env
mkdir -p data/materials data/exports
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d --build
# 首次：迁移 + 种子数据
docker compose -f docker-compose.yml -f docker-compose.dev.yml exec web npx prisma migrate dev --schema packages/db/prisma/schema.prisma
docker compose -f docker-compose.yml -f docker-compose.dev.yml exec worker npm run seed
```
访问 http://localhost:3000

## 测试账号
| 角色 | 账号 | 密码 |
|---|---|---|
| 运营 | operator | op123456 |
| 学员 | student | stu123456 |
| 学员密钥 | DEMO-KEY-2026 | — |

## 生产模式（服务器部署同此）
```bash
docker compose up -d --build
docker compose exec web npx prisma migrate deploy --schema packages/db/prisma/schema.prisma
docker compose exec worker npm run seed   # 首次
```

## 单元测试
```bash
npm install && npx vitest run
```
```

- [ ] **Step 2: 全闭环 curl 验收（快乐路径）**

Run:
```bash
J=/tmp/stu.txt
curl -s -c $J -X POST http://localhost:3000/api/auth/login -H 'Content-Type: application/json' -d '{"account":"student","password":"stu123456"}'
SID=$(curl -s -b $J http://localhost:3000/api/scripts | python3 -c 'import json,sys;print([s["id"] for s in json.load(sys.stdin) if s["title"]=="育儿好物推荐"][0])')
TID=$(curl -s -b $J -X POST http://localhost:3000/api/tasks -H 'Content-Type: application/json' -d "{\"scriptId\":\"$SID\",\"aspectRatio\":\"9:16\"}" | python3 -c 'import json,sys;print(json.load(sys.stdin)["id"])')
# 轮询到 PREVIEW_PENDING（渲染 4 段约 1-2 分钟）
for i in $(seq 1 60); do S=$(curl -s -b $J http://localhost:3000/api/tasks/$TID | python3 -c 'import json,sys;print(json.load(sys.stdin)["status"])'); echo $S; [ "$S" = "PREVIEW_PENDING" ] && break; [ "$S" = "FAILED" ] && exit 1; sleep 5; done
curl -s -b $J -X POST http://localhost:3000/api/tasks/$TID/confirm-preview
for i in $(seq 1 30); do S=$(curl -s -b $J http://localhost:3000/api/tasks/$TID | python3 -c 'import json,sys;print(json.load(sys.stdin)["status"])'); echo $S; [ "$S" = "EXPORTED" ] && break; sleep 5; done
curl -s -b $J http://localhost:3000/api/tasks/$TID/export
docker compose -f docker-compose.yml -f docker-compose.dev.yml exec worker ffprobe -v error -select_streams v:0 -show_entries stream=width,height -of csv=p=0 /data/exports/$TID/final.mp4
```
Expected: 状态推进 `…→PREVIEW_PENDING→…→EXPORTED`；export 返回三个 URL；ffprobe 输出 `1080,1920`。再用 `16:9` 建一单，ffprobe 应输出 `1920,1080`。

- [ ] **Step 3: 素材不足路径验收**

用《神秘小说安利》建任务 → 状态应停在 `MATERIAL_PENDING`（"小说类"无素材）。运营端：任务详情缺素材段高亮 →「去素材库上传」→ 上传任一测试视频并勾"小说类"→ 返回任务 →「关联素材」→ 任务自动推进至 `PREVIEW_PENDING`。
Expected: 完整走通开发文档的 MATERIAL_PENDING 分支。

- [ ] **Step 4: 修改回路 + 质检回路验收**

在 `PREVIEW_PENDING` 任务上（运营端）：改字幕/换素材/调序 → 保存重渲染 → 确认 → EXPORTED。
说明：改字幕时 revise 会把该段 `endMs` 置空、渲染时按新文本重新估时，因此正常操作不会触发"字幕越界"——该规则的正确性由 Task 3 单测覆盖；集成层只验证每轮质检向 `qc_reports` 写入三行记录（black_frame / silence / subtitle_overflow）。
Expected: 每轮质检 `qc_reports` 新增三行；revise 后重新质检的数据正确。

- [ ] **Step 5: 移动端适配验收（375px 视口过一遍）**

Chrome DevTools iPhone SE (375×667) 逐页检查：
- 学员端：/login、/（选文案+规格+生成）、/works（tabs）、/works/[id]（播放/确认/下载）
- 运营端：/admin/tags（折叠树）、/admin/materials（上传+进度条）、/admin/scripts + 详情（分段打标签）、/admin/tasks + 详情（分镜卡片、底部抽屉、上下移）
Expected: 无横向滚动、按钮可点区域 ≥40px 高、底部导航不遮挡内容（pb-20 生效）、视频不溢出。

- [ ] **Step 6: 生产构建验证（上服务器前置条件）**

Run:
```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml down
docker compose up -d --build
docker compose exec web npx prisma migrate deploy --schema packages/db/prisma/schema.prisma
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3000/login
```
Expected: `next build` 成功（无类型错误）、prod 模式 200。验证后可切回 dev 模式。

- [ ] **Step 7: 最终提交**

```bash
npx vitest run   # 全部单测通过
git add -A
git commit -m "chore: README 与本地 Docker 全链路验收"
```

---

## 计划自审记录

- **Spec 覆盖**：spec 第 1 节三条新增需求 → Task 1/16（Docker 本地）、全部 UI 任务（移动优先）、Task 3/9/11（双规格）；spec 第 3 节 7 条决策 → ①Task 2/8（status）②Task 2/9/11（aspectRatio+模糊垫底）③Task 11（SRT 单一来源）④Task 6/7/14（折叠树/原生上传/底部抽屉/上下移）⑤Task 15（seed）⑥Task 5（JWT cookie）⑦Task 3/12（6字/秒阈值）。开发文档 API 清单逐条对应 Task 5-9；页面清单对应 Task 6/7/8/13/14；质检三项对应 Task 12。
- **状态图补充**（FAILED、REVISING→RENDERING、QC_FAILED→QC_RUNNING）已在 Global Constraints 声明理由。
- **类型一致性**：全部共享签名集中在 `@mixcut/db`（Task 3/4 的 Interfaces 块），后续任务按名引用已核对。




