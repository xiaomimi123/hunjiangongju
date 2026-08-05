# 剪映工程文件夹一键导入 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 「剪映模板」页直接选整个剪映工程文件夹：自动解析 draft_content.json 存框架，BGM/图片素材自动入库并关联框架，生成时自动用原 BGM + 原素材。

**Architecture:** packages/db 新增纯函数（媒体清单提取 + 框架默认值读取）→ parse 接口扩展响应 → 新 import 接口（媒体入库 + 建框架）→ worker BGM 三级级联 → 生成页预填。渲染契约 `TemplateParams` 与 `parseTemplateParams` 零改动，无数据库迁移。

**Tech Stack:** TypeScript monorepo（web Next.js App Router / worker / packages/db `@mixcut/db` index-only 导出），vitest，Prisma。

设计依据：`docs/superpowers/specs/2026-08-06-jianying-folder-import-design.md`。实地样例：`今天分享的是/`（勿提交，用户数据；测试一律用合成夹具）。

## Global Constraints

- 测试命令：`DATABASE_URL=postgresql://mixcut:mixcut@localhost:55433/mixcut_test?schema=public npx vitest run`（本机 dev postgres：`docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d postgres`）。
- 每任务结束：相关测试绿 + `npx tsc --noEmit -p worker/tsconfig.json` exit 0；触 web 的任务加 `npm run build -w web`。
- `@mixcut/db` 只从 `src/index.ts` 导出；web 服务端代码只 `from '@mixcut/db'`。**client 组件禁止 import `@mixcut/db` 包根**（barrel 拉进 bullmq/ioredis 会炸 client bundle）。
- 鉴权/限流沿用现有 `/api/admin/*`：`requireRole('operator')` + `checkRate`。
- 上传校验沿用 all-validate-before-any-write（先全量校验再落盘，见 `web/app/api/admin/assets/route.ts`）。
- 剪映 draft 媒体路径形如 `##_draftpath_placeholder_xxx_##/audio/文件名.mp3`，只取 basename 匹配。
- BGM 识别规则与 `parseJianyingDraft` 现行一致：audios 素材 `name` 含「歌曲」且不含「提取」；图片素材 = `materials.videos[]` 中 `type === 'photo'`。
- `__defaultBgmId` / `__defaultAssetFolder` 存 `framework.overlayTemplate` 顶层（与 `books`/`watermark` 同层），不进 `__templateParams`。
- 文档语言中文；提交信息带 `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`。

---

### Task 1: `draftMedia.ts` 纯函数（媒体清单提取 + 框架默认值读取）

**Files:**
- Create: `packages/db/src/booklist/draftMedia.ts`
- Modify: `packages/db/src/index.ts`（追加导出）
- Test: `packages/db/src/booklist/draftMedia.test.ts`

**Interfaces:**
- Produces（后续任务全部依赖，签名务必一致）：
  ```ts
  export interface DraftMediaWanted {
    bgm: { fileName: string; title: string }[]   // fileName=草稿内路径 basename；title=素材名(如"歌曲20260702-02")
    images: string[]                              // 图片文件 basename（去重，仅 jpg/jpeg/png/webp）
  }
  export function extractDraftMedia(draft: unknown): DraftMediaWanted
  export interface FrameworkDefaults { bgmId: string | null; assetFolder: string | null }
  export function readFrameworkDefaults(overlayTemplate: unknown): FrameworkDefaults
  ```
- `@mixcut/db` index 导出以上 4 个符号。

- [ ] **Step 1: 写失败测试**

`packages/db/src/booklist/draftMedia.test.ts`：

```ts
import { describe, it, expect } from 'vitest'
import { extractDraftMedia, readFrameworkDefaults } from './draftMedia'

const P = '##_draftpath_placeholder_ABC_##'
const draft = {
  materials: {
    audios: [
      { id: 'a1', name: '歌曲20260702-02', path: `${P}/audio/9DF714A2.mp3`, type: 'extract_music' },
      { id: 'a2', name: '歌曲20260702-02', path: `${P}/audio/9DF714A2.mp3`, type: 'extract_music' }, // 同文件重复引用
      { id: 'a3', name: '提取音乐20260702-02', path: `${P}/audio/6D166269.mov`, type: 'extract_music' }, // 配音参考,排除
      { id: 'a4', name: '发条旋钮转动齿轮', path: `${P}/audio/7008917.mp3`, type: 'sound' }, // 音效,排除
    ],
    videos: [
      { id: 'v1', type: 'video', path: `${P}/video/REAL_SHOT.mov` }, // 实拍,排除
      { id: 'v2', type: 'photo', path: `${P}/video/IMG_A.png` },
      { id: 'v3', type: 'photo', path: `${P}/video/IMG_A.png` }, // 重复,去重
      { id: 'v4', type: 'photo', path: `${P}/video/IMG_B.jpg` },
      { id: 'v5', type: 'photo', path: `${P}/video/IMG_C.heic` }, // 不支持的扩展,排除
    ],
  },
}

describe('extractDraftMedia', () => {
  it('BGM=「歌曲」非「提取」轨,按文件名去重;图片=photo 素材白名单扩展去重', () => {
    expect(extractDraftMedia(draft)).toEqual({
      bgm: [{ fileName: '9DF714A2.mp3', title: '歌曲20260702-02' }],
      images: ['IMG_A.png', 'IMG_B.jpg'],
    })
  })
  it('非对象/缺 materials → 空清单', () => {
    expect(extractDraftMedia(null)).toEqual({ bgm: [], images: [] })
    expect(extractDraftMedia({})).toEqual({ bgm: [], images: [] })
    expect(extractDraftMedia({ materials: { audios: 'x', videos: 42 } })).toEqual({ bgm: [], images: [] })
  })
})

describe('readFrameworkDefaults', () => {
  it('读出 overlayTemplate 顶层 __defaultBgmId/__defaultAssetFolder', () => {
    expect(readFrameworkDefaults({ __defaultBgmId: 'b1', __defaultAssetFolder: '今天分享的是' }))
      .toEqual({ bgmId: 'b1', assetFolder: '今天分享的是' })
  })
  it('缺失/空串/非字符串/非对象 → null', () => {
    expect(readFrameworkDefaults({})).toEqual({ bgmId: null, assetFolder: null })
    expect(readFrameworkDefaults({ __defaultBgmId: '', __defaultAssetFolder: 42 })).toEqual({ bgmId: null, assetFolder: null })
    expect(readFrameworkDefaults(null)).toEqual({ bgmId: null, assetFolder: null })
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `DATABASE_URL=postgresql://mixcut:mixcut@localhost:55433/mixcut_test?schema=public npx vitest run packages/db/src/booklist/draftMedia.test.ts`
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 实现 `draftMedia.ts`**

```ts
// 从剪映 draft_content.json 提取「值得上传入库的媒体文件清单」+ 读框架默认值。
// 纯函数、不抛错。BGM/图片判定规则与 parseJianyingDraft 现行口径一致。

export interface DraftMediaWanted {
  bgm: { fileName: string; title: string }[]
  images: string[]
}

export interface FrameworkDefaults {
  bgmId: string | null
  assetFolder: string | null
}

const IMAGE_EXT = /\.(jpe?g|png|webp)$/i

function obj(x: unknown): Record<string, unknown> {
  return x && typeof x === 'object' && !Array.isArray(x) ? (x as Record<string, unknown>) : {}
}
function arr(x: unknown): unknown[] {
  return Array.isArray(x) ? x : []
}
function basename(p: unknown): string | undefined {
  if (typeof p !== 'string' || !p) return undefined
  const b = p.split('/').pop()
  return b || undefined
}

export function extractDraftMedia(draft: unknown): DraftMediaWanted {
  const materials = obj(obj(draft).materials)
  const bgm: { fileName: string; title: string }[] = []
  const seenBgm = new Set<string>()
  for (const raw of arr(materials.audios)) {
    const a = obj(raw)
    const name = typeof a.name === 'string' ? a.name : ''
    if (!/歌曲/.test(name) || /提取/.test(name)) continue
    const fileName = basename(a.path)
    if (!fileName || seenBgm.has(fileName)) continue
    seenBgm.add(fileName)
    bgm.push({ fileName, title: name })
  }
  const images: string[] = []
  const seenImg = new Set<string>()
  for (const raw of arr(materials.videos)) {
    const v = obj(raw)
    if (v.type !== 'photo') continue
    const fileName = basename(v.path)
    if (!fileName || !IMAGE_EXT.test(fileName) || seenImg.has(fileName)) continue
    seenImg.add(fileName)
    images.push(fileName)
  }
  return { bgm, images }
}

export function readFrameworkDefaults(overlayTemplate: unknown): FrameworkDefaults {
  const o = obj(overlayTemplate)
  const s = (x: unknown) => (typeof x === 'string' && x.trim() ? x.trim() : null)
  return { bgmId: s(o.__defaultBgmId), assetFolder: s(o.__defaultAssetFolder) }
}
```

`packages/db/src/index.ts` 末尾追加：

```ts
export { extractDraftMedia, readFrameworkDefaults } from './booklist/draftMedia.js'
export type { DraftMediaWanted, FrameworkDefaults } from './booklist/draftMedia.js'
```

- [ ] **Step 4: 跑测试确认通过**

Run: 同 Step 2。Expected: PASS。再跑 `npx tsc --noEmit -p worker/tsconfig.json`，exit 0。

- [ ] **Step 5: 提交**

```bash
git add packages/db/src/booklist/draftMedia.ts packages/db/src/booklist/draftMedia.test.ts packages/db/src/index.ts
git commit -m "feat(jianying): 草稿媒体清单提取+框架默认值读取纯函数"
```

---

### Task 2: parse 接口扩展返回 `media` 清单

**Files:**
- Modify: `web/app/api/admin/jianying/parse/route.ts`
- Test: `web/app/api/admin/jianying/parse/route.test.ts`（已有则扩展；没有则新建，模式仿 `web/app/api/bgm/route.test.ts` 的 route 测试写法：直接 import `POST`，构造 `new Request()`，mock session 用该测试文件既有方式——先读同目录/邻近 route 测试确认 mock 约定再写）

**Interfaces:**
- Consumes: Task 1 `extractDraftMedia`。
- Produces: parse 响应新增字段 `media: DraftMediaWanted`（原 `templateParams`/`meta` 不变）。前端（Task 6）依赖 `media.bgm[].fileName/.title`、`media.images[]`。

- [ ] **Step 1: 写失败测试**

在 parse 的 route 测试中新增用例（Request 构造与既有用例一致）：

```ts
it('响应包含 media 清单(BGM/图片)', async () => {
  const P = '##_draftpath_placeholder_X_##'
  const draftJson = {
    materials: {
      audios: [{ id: 'a1', name: '歌曲A', path: `${P}/audio/song.mp3`, type: 'extract_music' }],
      videos: [{ id: 'v1', type: 'photo', path: `${P}/video/pic.png` }],
    },
  }
  const res = await POST(new Request('http://t/api/admin/jianying/parse', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ draftJson }),
  }))
  expect(res.status).toBe(200)
  const j = await res.json()
  expect(j.media).toEqual({ bgm: [{ fileName: 'song.mp3', title: '歌曲A' }], images: ['pic.png'] })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `DATABASE_URL=... npx vitest run web/app/api/admin/jianying/parse/route.test.ts`
Expected: 新用例 FAIL（`media` undefined）。

- [ ] **Step 3: 实现**

`parse/route.ts`：import 增加 `extractDraftMedia`，末尾改为：

```ts
  const { params, meta } = parseJianyingDraft(draft)
  return NextResponse.json({ templateParams: params, meta, media: extractDraftMedia(draft) })
```

- [ ] **Step 4: 跑测试确认通过**（该文件全部用例绿）

- [ ] **Step 5: 提交** `feat(jianying): parse 响应附媒体清单`

---

### Task 3: import 接口（媒体入库 + 建框架 + 默认值写入）

**Files:**
- Create: `web/app/api/admin/jianying/import/route.ts`
- Test: `web/app/api/admin/jianying/import/route.test.ts`

**Interfaces:**
- Consumes: Task 1 类型；`prisma.bgmLibrary/stockAsset/copyFramework`；`parseTemplateParams`（`@mixcut/db`）。
- Produces: `POST /api/admin/jianying/import`，multipart 字段：
  - `name`(框架名) · `projectName`(工程名,作媒体 folder) · `templateParams`(JSON 字符串) · `bgmMeta`(JSON 字符串 `[{fileName,title}]`)
  - `bgmFiles`(File[]) · `imageFiles`(File[])
  - 响应：`{ id, bgm: { imported, reused }, assets: { imported, reused }, skipped: string[] }`（Task 6 前端消费）。
- 幂等：BGM 按 `(folder=projectName, name=title)`、素材按 `(folder=projectName, name=去扩展名文件名)` 已存在则复用不重建。

- [ ] **Step 1: 写失败测试**

`import/route.test.ts`（mock session/鉴权方式仿 `web/app/api/admin/assets/route.test.ts`；DB 清理用 per-file tracked ids，别 `deleteMany({})`——测试库表是共享的）：

```ts
import { describe, it, expect, afterAll } from 'vitest'
import { POST } from './route'
import { prisma } from '@mixcut/db'

const createdBgm: string[] = []
const createdAssets: string[] = []
const createdFw: string[] = []
afterAll(async () => {
  await prisma.bgmLibrary.deleteMany({ where: { id: { in: createdBgm } } })
  await prisma.stockAsset.deleteMany({ where: { id: { in: createdAssets } } })
  await prisma.copyFramework.deleteMany({ where: { id: { in: createdFw } } })
})

function makeForm(over: Partial<Record<string, string>> = {}) {
  const form = new FormData()
  form.set('name', over.name ?? '导入测试框架')
  form.set('projectName', over.projectName ?? '导入测试工程')
  form.set('templateParams', over.templateParams ?? JSON.stringify({ mode: 'flash' }))
  form.set('bgmMeta', over.bgmMeta ?? JSON.stringify([{ fileName: 'song.mp3', title: '歌曲A' }]))
  form.append('bgmFiles', new File([new Uint8Array([1, 2, 3])], 'song.mp3', { type: 'audio/mpeg' }))
  form.append('imageFiles', new File([new Uint8Array([9, 9])], 'pic.png', { type: 'image/png' }))
  return form
}
async function call(form: FormData) {
  return POST(new Request('http://t/api/admin/jianying/import', { method: 'POST', body: form }))
}

it('入库 BGM+素材,建框架并写默认值', async () => {
  const res = await call(makeForm())
  expect(res.status).toBe(200)
  const j = await res.json()
  createdFw.push(j.id)
  expect(j.bgm).toEqual({ imported: 1, reused: 0 })
  expect(j.assets).toEqual({ imported: 1, reused: 0 })
  const fw = await prisma.copyFramework.findUniqueOrThrow({ where: { id: j.id } })
  const ot = fw.overlayTemplate as Record<string, unknown>
  const bgm = await prisma.bgmLibrary.findFirstOrThrow({ where: { folder: '导入测试工程', name: '歌曲A' } })
  createdBgm.push(bgm.id)
  expect(ot.__defaultBgmId).toBe(bgm.id)
  expect(ot.__defaultAssetFolder).toBe('导入测试工程')
  const asset = await prisma.stockAsset.findFirstOrThrow({ where: { folder: '导入测试工程', name: 'pic' } })
  createdAssets.push(asset.id)
  expect(asset.kind).toBe('image')
})

it('重复导入:媒体复用不重建,框架新建', async () => {
  const res = await call(makeForm())
  const j = await res.json()
  createdFw.push(j.id)
  expect(j.bgm).toEqual({ imported: 0, reused: 1 })
  expect(j.assets).toEqual({ imported: 0, reused: 1 })
  expect(await prisma.bgmLibrary.count({ where: { folder: '导入测试工程', name: '歌曲A' } })).toBe(1)
})

it('非法媒体扩展 → 400 且零写入', async () => {
  const form = makeForm({ projectName: '导入测试工程2' })
  form.append('imageFiles', new File([new Uint8Array([1])], 'evil.exe'))
  const res = await call(form)
  expect(res.status).toBe(400)
  expect(await prisma.stockAsset.count({ where: { folder: '导入测试工程2' } })).toBe(0)
  expect(await prisma.bgmLibrary.count({ where: { folder: '导入测试工程2' } })).toBe(0)
})

it('框架名为空 → 400', async () => {
  const res = await call(makeForm({ name: ' ' }))
  expect(res.status).toBe(400)
})
```

（若 assets 的 route 测试里鉴权是通过 mock `@/lib/auth` 实现的，这里照抄同一段 mock；越权 403 用例也照它的写法补一条。）

- [ ] **Step 2: 跑测试确认失败**（模块不存在）

- [ ] **Step 3: 实现 `import/route.ts`**

```ts
import { NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import path from 'path'
import fs from 'fs/promises'
import type { Prisma } from '@prisma/client'
import { prisma, parseTemplateParams } from '@mixcut/db'
import { requireRole, HttpError } from '@/lib/auth'
import { handler } from '@/lib/api'
import { checkRate } from '@/lib/ratelimit'
import { DATA_DIR } from '@/lib/paths'

const AUDIO_EXT = new Set(['.mp3', '.wav', '.m4a', '.aac', '.ogg'])
const IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp'])

// 剪映工程一键导入：媒体入库(幂等) + 建框架 + overlayTemplate 写 __defaultBgmId/__defaultAssetFolder。
// all-validate-before-any-write：先全量校验扩展名/字段,再落盘。
export const POST = handler(async (req) => {
  const s = await requireRole('operator')
  checkRate('jianying-import', s.userId, 10)
  const form = await req.formData()
  const name = String(form.get('name') ?? '').trim()
  if (!name) throw new HttpError(400, '框架名不能为空')
  const projectName = String(form.get('projectName') ?? '').trim()
  if (!projectName) throw new HttpError(400, '工程名不能为空')
  let templateParams: unknown
  try {
    templateParams = JSON.parse(String(form.get('templateParams') ?? ''))
  } catch {
    throw new HttpError(400, 'templateParams 不是合法 JSON')
  }
  let bgmMeta: { fileName: string; title: string }[] = []
  try {
    const parsed = JSON.parse(String(form.get('bgmMeta') ?? '[]'))
    if (Array.isArray(parsed)) {
      bgmMeta = parsed.filter(
        (x): x is { fileName: string; title: string } =>
          x && typeof x === 'object' && typeof x.fileName === 'string' && typeof x.title === 'string',
      )
    }
  } catch {
    throw new HttpError(400, 'bgmMeta 不是合法 JSON')
  }

  const bgmFiles = form.getAll('bgmFiles').filter((f): f is File => f instanceof File)
  const imageFiles = form.getAll('imageFiles').filter((f): f is File => f instanceof File)

  // 全量校验
  for (const f of bgmFiles) {
    if (!AUDIO_EXT.has(path.extname(f.name).toLowerCase())) throw new HttpError(400, `不支持的音频文件：${f.name}`)
  }
  for (const f of imageFiles) {
    if (!IMAGE_EXT.has(path.extname(f.name).toLowerCase())) throw new HttpError(400, `不支持的图片文件：${f.name}`)
  }

  const skipped: string[] = []
  const bgmStat = { imported: 0, reused: 0 }
  const assetStat = { imported: 0, reused: 0 }

  // BGM 入库（幂等键：folder=工程名 + name=曲名）
  let defaultBgmId: string | null = null
  await fs.mkdir(path.join(DATA_DIR, 'bgm'), { recursive: true })
  for (const f of bgmFiles) {
    const title = bgmMeta.find((m) => m.fileName === f.name)?.title ?? path.basename(f.name, path.extname(f.name))
    const existing = await prisma.bgmLibrary.findFirst({ where: { folder: projectName, name: title } })
    if (existing) {
      bgmStat.reused++
      defaultBgmId = defaultBgmId ?? existing.id
      continue
    }
    const id = randomUUID()
    const rel = `bgm/${id}${path.extname(f.name).toLowerCase()}`
    await fs.writeFile(path.join(DATA_DIR, rel), Buffer.from(await f.arrayBuffer()))
    await prisma.bgmLibrary.create({
      data: { id, fileUrl: `/api/files/${rel}`, styleTag: null, durationMs: null, name: title, folder: projectName },
    })
    bgmStat.imported++
    defaultBgmId = defaultBgmId ?? id
  }

  // 图片素材入库（幂等键：folder=工程名 + name=去扩展名文件名）
  await fs.mkdir(path.join(DATA_DIR, 'assets'), { recursive: true })
  for (const f of imageFiles) {
    const assetName = path.basename(f.name, path.extname(f.name))
    const existing = await prisma.stockAsset.findFirst({ where: { folder: projectName, name: assetName } })
    if (existing) {
      assetStat.reused++
      continue
    }
    const id = randomUUID()
    const rel = `assets/${id}${path.extname(f.name).toLowerCase()}`
    await fs.writeFile(path.join(DATA_DIR, rel), Buffer.from(await f.arrayBuffer()))
    await prisma.stockAsset.create({ data: { id, kind: 'image', name: assetName, folder: projectName, fileUrl: `/api/files/${rel}` } })
    assetStat.imported++
  }

  // 建框架（口径同 jianying/save）+ 默认值
  const normalized = { ...parseTemplateParams(templateParams), mode: 'flash' as const }
  const overlayTemplate: Record<string, unknown> = { __templateParams: normalized }
  if (defaultBgmId) overlayTemplate.__defaultBgmId = defaultBgmId
  if (assetStat.imported + assetStat.reused > 0) overlayTemplate.__defaultAssetFolder = projectName

  const fw = await prisma.copyFramework.create({
    data: {
      name,
      frameworkText: '（从剪映草稿导入的快闪模板，仅含画面/节奏参数，无文案框架，使用前请补充/编辑文案框架）',
      overlayTemplate: overlayTemplate as unknown as Prisma.InputJsonValue,
      createdBy: s.userId,
    },
  })
  return NextResponse.json({ id: fw.id, bgm: bgmStat, assets: assetStat, skipped })
})
```

- [ ] **Step 4: 跑测试确认通过**

Run: `DATABASE_URL=... npx vitest run web/app/api/admin/jianying/import/route.test.ts`，全绿；`npm run build -w web` 成功。

- [ ] **Step 5: 提交** `feat(jianying): import 接口(媒体幂等入库+建框架+默认BGM/素材关联)`

---

### Task 4: worker BGM 三级级联（手选 > 框架默认 > 随机）

**Files:**
- Modify: `worker/src/gen/renderVisuals.ts:172-189`（BGM 选择块）
- Test: `worker/src/gen/renderVisuals.buildBodyData.test.ts` 不动；`readFrameworkDefaults` 纯函数已在 Task 1 测过，此处只测接线逻辑抽出的纯函数

**Interfaces:**
- Consumes: Task 1 `readFrameworkDefaults`（从 `@mixcut/db` import）。
- Produces: 行为变化——`variables.__bgmId` 缺失时优先用框架 `__defaultBgmId`（校验记录仍存在），再回退随机。

- [ ] **Step 1: 修改 renderVisuals.ts**

BGM 选择块改为（`task` 已 `include: { framework: true }`）：

```ts
  const vars = task.variables as { __bgmId?: string } | null
  let bgmId: string | null = null
  if (vars && typeof vars === 'object' && vars.__bgmId) {
    const bgm = await prisma.bgmLibrary.findUnique({ where: { id: vars.__bgmId } })
    bgmId = bgm?.id ?? null
  }
  // 次优先：剪映导入框架的默认 BGM（原工程同款）。校验仍存在，避免陈旧 id 触发 FK 失败。
  if (!bgmId) {
    const defaultBgmId = readFrameworkDefaults(task.framework.overlayTemplate).bgmId
    if (defaultBgmId) {
      const bgm = await prisma.bgmLibrary.findUnique({ where: { id: defaultBgmId } })
      bgmId = bgm?.id ?? null
    }
  }
  // 未指定 → 曲库随机（现状兜底,注释保留原样）
```

import 行加 `readFrameworkDefaults`（来自 `@mixcut/db`，与现有 `prisma` 同行合并）。

- [ ] **Step 2: 验证**

Run: `npx tsc --noEmit -p worker/tsconfig.json`（exit 0）+ 全量 `DATABASE_URL=... npx vitest run`（回归绿）。
（接线为 3 行 DB 查询级联，无新纯函数可单测；`readFrameworkDefaults` 的边界已由 Task 1 测试覆盖，陈旧 id 回退由「bgm 查不到 → bgmId 仍 null → 落入随机」的代码结构保证，评审时人工确认。）

- [ ] **Step 3: 提交** `feat(gen): BGM 选择支持框架默认(剪映原工程同款)级联`

---

### Task 5: /api/frameworks 返回 defaultAssetFolder + 生成页预填

**Files:**
- Modify: `web/app/api/frameworks/route.ts`
- Modify: `web/app/admin/generate/page.tsx`（`frameworkId` 变化时预填配图来源）
- Test: `web/app/api/frameworks/route.test.ts`（已有则扩展，仿现有用例）

**Interfaces:**
- Consumes: Task 1 `readFrameworkDefaults`。
- Produces: `/api/frameworks` 每行新增 `defaultAssetFolder: string | null`；生成页 `Framework` 类型同步。

- [ ] **Step 1: 写失败测试**（frameworks route 测试新增用例；建测试数据的框架 overlayTemplate 带 `__defaultAssetFolder`，断言响应行含 `defaultAssetFolder`；记得 tracked-id 清理）

```ts
it('带 __defaultAssetFolder 的框架 → 响应含 defaultAssetFolder', async () => {
  const fw = await prisma.copyFramework.create({
    data: { name: '预填测试', frameworkText: 'x', overlayTemplate: { __defaultAssetFolder: '工程甲' } },
  })
  createdFw.push(fw.id)
  const res = await GET(new Request('http://t/api/frameworks'))
  const rows = await res.json()
  const row = rows.find((r: { id: string }) => r.id === fw.id)
  expect(row.defaultAssetFolder).toBe('工程甲')
})
```

- [ ] **Step 2: 跑测试确认失败**

- [ ] **Step 3: 实现**

route：select 加 `overlayTemplate: true`，返回前映射（不把整个 overlayTemplate 发给前端）：

```ts
  const rows = await prisma.copyFramework.findMany({
    orderBy: { createdAt: 'desc' },
    select: { id: true, name: true, industryCategory: true, visualStyleType: true, published: true, degradedNote: true, createdAt: true, overlayTemplate: true },
  })
  return NextResponse.json(rows.map(({ overlayTemplate, ...r }) => ({
    ...r,
    defaultAssetFolder: readFrameworkDefaults(overlayTemplate).assetFolder,
  })))
```

generate/page.tsx：`Framework` 类型加 `defaultAssetFolder: string | null`；`frameworkId` 的 select `onChange` 改为：

```tsx
onChange={(e) => {
  const id = e.target.value
  setFrameworkId(id)
  const fw = frameworks.find((f) => f.id === id)
  // 剪映导入的框架自动预填「素材库优先 + 原工程文件夹」;运营可手动改回 AI
  if (fw?.defaultAssetFolder) { setAssetSource('library'); setAssetFolder(fw.defaultAssetFolder) }
}}
```

- [ ] **Step 4: 验证** route 测试绿 + `npm run build -w web` 成功。

- [ ] **Step 5: 提交** `feat(web): 剪映导入框架在生成页预填素材库配图来源`

---

### Task 6: 「剪映模板」页文件夹上传改造

**Files:**
- Modify: `web/app/admin/jianying/page.tsx`

**Interfaces:**
- Consumes: parse 响应 `{ templateParams, meta, media }`（Task 2）；import 接口（Task 3）。
- Produces: 纯 UI，无下游依赖。

- [ ] **Step 1: 实现页面改造**

改造点（保留现有粘贴 JSON + 解析预览 + 旧「保存为框架」路径作兜底，新增文件夹主路径）：

1. 顶部新增文件夹选择（`webkitdirectory` 是非标准属性，TS/JSX 不认识，需如下写法）：

```tsx
const folderInputRef = useRef<HTMLInputElement>(null)
useEffect(() => {
  folderInputRef.current?.setAttribute('webkitdirectory', '')
}, [])
// state 增加：
const [folderFiles, setFolderFiles] = useState<File[]>([])
const [projectName, setProjectName] = useState('')
const [media, setMedia] = useState<{ bgm: { fileName: string; title: string }[]; images: string[] } | null>(null)
const [importing, setImporting] = useState(false)
const [importErr, setImportErr] = useState('')
const [importResult, setImportResult] = useState<{ id: string; bgm: { imported: number; reused: number }; assets: { imported: number; reused: number } } | null>(null)
```

2. 文件夹选择处理：找 `draft_content.json`（`f.name === 'draft_content.json'`），没有则 `setParseErr('这不是剪映工程文件夹（未找到 draft_content.json）')`；有则读文本、`setRaw(text)`、取工程名 `file.webkitRelativePath.split('/')[0]`（兜底 `'剪映工程'`）填入 `projectName` 和框架名 `name`（若为空），随后自动调用 `parse()`。

```tsx
async function onFolderChange(e: React.ChangeEvent<HTMLInputElement>) {
  const files = Array.from(e.target.files ?? [])
  setFolderFiles(files)
  setImportResult(null)
  const draftFile = files.find((f) => f.name === 'draft_content.json')
  if (!draftFile) { setParseErr('这不是剪映工程文件夹（未找到 draft_content.json）'); return }
  const proj = (draftFile as File & { webkitRelativePath?: string }).webkitRelativePath?.split('/')[0] || '剪映工程'
  setProjectName(proj)
  if (!name.trim()) setName(proj)
  const text = await draftFile.text()
  setRaw(text)
  await parse(text) // parse 改为可接收显式文本参数,避免 setState 异步竞态
}
```

3. `parse()` 改签名 `parse(rawText?: string)`，内部 `const src = rawText ?? raw`；成功时 `setMedia(r.media ?? null)`（响应类型加 `media`）。

4. 解析预览卡片内、原「保存为框架」旁新增主按钮「一键导入（含 BGM/素材）」，仅当 `folderFiles.length > 0 && media` 时展示；点击：

```tsx
async function importAll() {
  if (!templateParams || !media) return
  if (!name.trim()) { setImportErr('请填写框架名'); return }
  setImportErr(''); setImporting(true)
  try {
    const byName = new Map(folderFiles.map((f) => [f.name, f]))
    const form = new FormData()
    form.set('name', name.trim())
    form.set('projectName', projectName || '剪映工程')
    form.set('templateParams', JSON.stringify(templateParams))
    const foundBgm = media.bgm.filter((b) => byName.has(b.fileName))
    form.set('bgmMeta', JSON.stringify(foundBgm))
    for (const b of foundBgm) form.append('bgmFiles', byName.get(b.fileName)!)
    for (const img of media.images) { const f = byName.get(img); if (f) form.append('imageFiles', f) }
    const missing = [...media.bgm.map((b) => b.fileName), ...media.images].filter((n) => !byName.has(n))
    const r = await fetch('/api/admin/jianying/import', { method: 'POST', body: form })
    if (!r.ok) throw new Error((await r.json().catch(() => ({})))?.error ?? `导入失败(${r.status})`)
    const j = await r.json()
    setImportResult(j)
    if (missing.length > 0) setImportErr(`已导入,但 ${missing.length} 个媒体文件在文件夹中未找到,已跳过: ${missing.join('、')}`)
  } catch (e) { setImportErr((e as Error).message) }
  finally { setImporting(false) }
}
```

（注意：`api()` fetcher 是 JSON body 专用，FormData 直接用 `fetch`——与 BGM 页上传写法一致，先看 `web/app/admin/bgm/page.tsx` 确认。）

5. 解析预览卡片增加媒体清单展示（`media.bgm` 列曲名、`media.images.length` 张图）；导入成功后摘要：

```tsx
{importResult && (
  <p className="pill pill-ok mt-2">
    已导入:框架创建 ✓ · BGM 入库 {importResult.bgm.imported} 首{importResult.bgm.reused > 0 && `(复用 ${importResult.bgm.reused})`} · 素材入库 {importResult.assets.imported} 张{importResult.assets.reused > 0 && `(复用 ${importResult.assets.reused})`}
    <Link href="/admin/frameworks" className="ml-2 underline">去框架库查看</Link>
  </p>
)}
```

6. 页面副标题改为「选择剪映工程文件夹，自动提取快闪配方、BGM 与素材并保存为框架」。

- [ ] **Step 2: 验证**

Run: `npm run build -w web`（类型校验+构建成功）+ 全量 vitest 回归绿。

- [ ] **Step 3: 提交** `feat(web): 剪映模板页支持整工程文件夹一键导入`

---

### Task 7: 终验 + 文档

**Files:**
- Modify: `README.md`（剪映模板功能描述更新：文件夹一键导入、媒体自动入库、生成联动）
- Modify: `docs/superpowers/specs/2026-08-06-jianying-folder-import-design.md`（状态改「已实现」）

- [ ] **Step 1: 终验**

```bash
DATABASE_URL=postgresql://mixcut:mixcut@localhost:55433/mixcut_test?schema=public npx vitest run
npx tsc --noEmit -p worker/tsconfig.json
npm run build -w web
```
Expected: 全绿 / exit 0 / 构建成功。

- [ ] **Step 2: 更新 README**（「剪映模板」条目改为文件夹导入描述，一两句即可，勿翻写全文）

- [ ] **Step 3: 提交** `docs: 剪映工程文件夹一键导入说明`
