# 后台增强五件套 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** 账号新增(学员+运营)/素材库批量上传+生成选用/画风油画梵高预设/火山克隆音色支持/BGM 批量上传改名分组,五个后台增强一批交付。

**Architecture:** 全部沿现有分层——web 路由(operator 鉴权 handler 模式)+ Prisma 加法迁移 + worker 纯函数可测。设计:`docs/superpowers/specs/2026-08-04-admin-batch5-design.md`。

**Tech Stack:** TypeScript monorepo(web Next.js / worker / packages/db @mixcut/db),vitest,Prisma/Postgres。

## Global Constraints
- 迁移仅两条加法:`stock_assets` 建表(Task 2)、`bgm_library` 加 `name/folder` 列(Task 5);`migrate deploy` 幂等。
- 渲染管线除 generate-image 素材分配外不动;`TemplateParams` 不动。
- web 路由一律 `handler(async …)` + `await requireRole('operator')` + `HttpError` 模式(照 `web/app/api/bgm/route.ts`)。
- 测试 DB:`DATABASE_URL=postgresql://mixcut:mixcut@localhost:55433/mixcut_test?schema=public`;每任务结束跑全量 vitest + `npx tsc --noEmit -p worker/tsconfig.json` + `npm run build -w web` 全绿。
- 新迁移创建后须对本地 dev(55433 的 mixcut)与 mixcut_test 两库都 `prisma migrate deploy`(测试库不迁移,DB 相关测试会挂)。
- 视频素材 v1 不参与生成(页面注明);克隆音色不带 context_texts。

---

## Task 1:后台新增账号(学员+运营)+ 运营账号管理

**Files:**
- Modify: `web/app/api/admin/students/route.ts`(加 POST 创建;GET 加 `role` 参数)
- Modify: `web/app/api/admin/students/[id]/route.ts`(放开 operator + 防锁死)
- Modify: `web/app/admin/students/page.tsx`(新增账号弹层 + 运营账号小节)
- Test: `web/app/api/admin/students/route.test.ts`(新建)

**Interfaces:**
- Produces:`POST /api/admin/students` body `{ email, nickname?, password, role:'student'|'operator' }` → 201 `{ id, email, role }`;重复 email→409;非法 role→400;弱密码→400(`assertPassword`)。
- `GET /api/admin/students?role=operator` → 运营列表(id/email/nickname/disabled/createdAt);缺省 `role=student` 走现有逻辑(向后兼容)。

- [ ] **Step 1: 失败测试** `web/app/api/admin/students/route.test.ts`——mock `@/lib/auth`(照 `web/app/api/admin/jianying/parse/route.test.ts` 的 `vi.mock` 写法,保留 `vi.importActual` 的 HttpError):
```ts
it('POST 创建学员', async () => { /* 200/201,库里 role=student,passwordHash 非明文 */ })
it('POST 创建运营', async () => { /* role=operator */ })
it('POST 重复 email → 409', async () => {})
it('POST 非法 role → 400', async () => {})
it('GET role=operator 只返回运营', async () => {})
```
用真测试库(现有 DB 测试写法,记得清理创建的用户)。运行确认失败。
- [ ] **Step 2: 实现 POST**(`route.ts` 追加):
```ts
export const POST = handler(async (req) => {
  await requireRole('operator')
  const { email, nickname, password, role } = await req.json()
  const em = String(email ?? '').trim().toLowerCase()
  if (!em || !/^\S+@\S+\.\S+$/.test(em)) throw new HttpError(400, '邮箱格式不正确')
  if (role !== 'student' && role !== 'operator') throw new HttpError(400, '角色只能是学员或运营')
  assertPassword(password)
  if (await prisma.user.findUnique({ where: { email: em } })) throw new HttpError(409, '该邮箱已存在')
  const u = await prisma.user.create({
    data: { email: em, nickname: String(nickname ?? '').trim() || null, passwordHash: await bcrypt.hash(password, 10), role },
    select: { id: true, email: true, role: true },
  })
  return NextResponse.json(u, { status: 201 })
})
```
(补 import bcrypt/assertPassword/HttpError。email 唯一冲突还应 catch P2002 → 409,并发兜底。)
- [ ] **Step 3: GET 加 role 参数**:`const role = url.searchParams.get('role') === 'operator' ? 'operator' : 'student'`;`where` 与两个 `count` 的 `role:'student'` 改用该变量;role=operator 时跳过"作品统计"块(返回 taskCount=0 即可)。
- [ ] **Step 4: `[id]` 防锁死**:`getStudent` 改 `getUser`(student|operator 都放行,其余 404)。PATCH/DELETE 目标是 operator 时:`const s = await requireRole('operator')`;若 `params.id === s.userId` → 400 '不能操作自己';若动作是 禁用/删除 且 `await prisma.user.count({ where: { role:'operator', disabled:false, id:{ not: params.id } } }) === 0` → 400 '至少保留一名可用运营'。
- [ ] **Step 5: 页面**:学员页头部加「新增账号」按钮 → 弹层(邮箱/昵称/密码/角色 select 默认学员)→ POST → 刷新列表。页顶加「运营账号」折叠小节:`GET ?role=operator` 列表 + 禁用/启用/重置密码(复用现有行操作组件逻辑)。样式照本页现有 card/btn。
- [ ] **Step 6: 验证+提交** 全量 vitest+tsc+web build 绿 → `feat(web): 后台新增账号(学员/运营)+运营账号管理与防锁死`

---

## Task 2:素材库(建表/批量上传/管理页/生成选用)

**Files:**
- Create: `packages/db/prisma/migrations/20260804120000_add_stock_assets/migration.sql` + schema.prisma 加 model
- Create: `web/app/api/admin/assets/route.ts`(GET 列表/POST 批量上传)、`web/app/api/admin/assets/[id]/route.ts`(PATCH/DELETE)
- Create: `web/app/admin/assets/page.tsx`;Modify: `web/components/SidebarNav.tsx`(「运营」组加「素材库」)
- Create: `worker/src/gen/stockAssets.ts`(纯函数)+ test;Modify: `worker/src/gen/generateImage.ts`
- Modify: `web/app/admin/generate/page.tsx`、`web/app/api/generate/normalize.ts`(assetSource/assetFolder 透传)
- Test: `worker/src/gen/stockAssets.test.ts`

**Interfaces:**
- Prisma:
```prisma
model StockAsset {
  id        String   @id @default(uuid())
  kind      String   // 'image' | 'video'
  name      String
  folder    String?
  fileUrl   String   @map("file_url")
  createdAt DateTime @default(now()) @map("created_at")
  @@map("stock_assets")
}
```
- `POST /api/admin/assets`:multipart `files[]`(多文件)+ `folder?` → 逐文件:扩展名 jpg/jpeg/png/webp→image,mp4/mov/webm→video,其余整单 400;存 `/data/assets/<uuid><ext>`;name=去扩展名文件名。返回 `{ created: [...], }`。
- `worker` 纯函数:
```ts
// 按序分配:assets[i] 给第 i 个分镜,超出部分 null(null→回退 AI 生图);不重复使用素材。
export function pickAssetsForSegments<T>(assets: T[], segCount: number): (T | null)[]
export function readAssetSource(variables: unknown): { source: 'ai' | 'library'; folder?: string }
```

- [ ] **Step 1: 迁移+model**:migration.sql 用 `CREATE TABLE IF NOT EXISTS "stock_assets" (...)`(列同 model,含 default);schema.prisma 加 model;对 dev 与 mixcut_test 两库 `npx prisma migrate deploy`;`npx prisma generate`。
- [ ] **Step 2: 失败测试** `worker/src/gen/stockAssets.test.ts`:
```ts
it('素材多于分镜:前 N 个按序分配', () => { expect(pickAssetsForSegments(['a','b','c'], 2)).toEqual(['a','b']) })
it('素材少于分镜:不足补 null 不循环', () => { expect(pickAssetsForSegments(['a'], 3)).toEqual(['a', null, null]) })
it('空素材:全 null', () => { expect(pickAssetsForSegments([], 2)).toEqual([null, null]) })
it('readAssetSource: library+folder / 缺省 ai / 非法值 ai', () => {})
```
- [ ] **Step 3: 实现纯函数** 使测试过。
- [ ] **Step 4: 上传/管理接口**:POST 照 bgm route 模式(多文件 `form.getAll('files')`);GET `?folder=` 过滤 + 返回去重 folders 清单;PATCH 改 `name/folder`;DELETE 直接删记录+文件(无 FK 引用)。
- [ ] **Step 5: generateImage 接入**:任务开头 `const { source, folder } = readAssetSource(task.variables)`;`source==='library'` 时查 `stockAsset.findMany({ where: { kind:'image', ...(folder?{folder}:{}) }, orderBy:{ createdAt:'asc' } })`,`pickAssetsForSegments(assets, segments.length)`;分镜有素材→把文件复制为 `gen/<taskId>/<seqNo><原ext>` 并写该 imageUrl,跳过 AI;为 null→走现有 AI 生图。书封分支不动(仍 AI)。
- [ ] **Step 6: 表单+normalize**:生成页加「配图来源」radio(AI 生图/素材库优先)+ 文件夹 select(GET assets 的 folders);normalize 收 `assetSource`(仅 'library' 透传)与 `assetFolder`(trim 字符串)进 variables。
- [ ] **Step 7: 管理页**:`/admin/assets` 网格(图片 `<img>` 缩略、视频占位块+「v1 不参与生成,仅存放」提示)、多选上传、folder 筛选、行内改名/改文件夹、删除。SidebarNav「运营」组加 `{ href:'/admin/assets', label:'素材库', icon:'doc' }`。
- [ ] **Step 8: 验证+提交** 全绿 → `feat: 素材库(批量上传/管理/生成时优先用素材不够AI补)`

---

## Task 3:画风预设(厚涂油画/梵高/治愈插画)

**Files:**
- Modify: `worker/src/gen/generateImage.ts`(空画风回退默认油画)、`worker/templates/booklist/bookCoverPrompt.ts`(默认 style)
- Modify: `web/app/admin/frameworks/page.tsx`(画风输入框旁 3 预设按钮)
- Test: 更新 `worker/templates/booklist/bookCoverPrompt.test.ts` 相关断言(若有默认值断言)

- [ ] **Step 1**: `generateImage.ts` 顶部加:
```ts
export const DEFAULT_IMAGE_STYLE = '厚涂油画质感,浓郁色彩,可见笔触,古典书卷氛围,无人物'
```
`const stylePrompt = (task.framework.imageStylePrompt ?? '').trim() || DEFAULT_IMAGE_STYLE`。
- [ ] **Step 2**: `bookCoverPrompt.ts` 默认 `styleHint ?? '文艺极简'` → `styleHint ?? '厚涂油画文艺'`;跑其测试,若断言旧默认则同步更新断言。
- [ ] **Step 3**: frameworks 页画风输入框旁加预设按钮(点击 setState 填充,可再改):
```ts
const STYLE_PRESETS = [
  { label: '厚涂油画', v: '厚涂油画质感,浓郁色彩,可见笔触,古典书卷氛围,无人物,静物/自然/动物' },
  { label: '梵高风', v: '梵高后印象派风格,旋转笔触,厚重颜料肌理,鲜明蓝黄对比,星夜质感,无人物' },
  { label: '治愈插画', v: '极简性冷淡治愈系艺术插画,动物自然静物,留白构图,无人物' },
]
```
- [ ] **Step 4: 验证+提交** 全绿 → `feat(gen): 画风默认厚涂油画 + 框架画风一键预设(油画/梵高/治愈)`

---

## Task 4:火山克隆音色(seed-icl-2.0 路由 + customVoices 免改码加音色)

**Files:**
- Modify: `packages/db/src/ai/ttsVoices.ts`(加 `isPlausibleVoiceId`)、`packages/db/src/ai/tts.ts`(克隆路由)、`packages/db/src/index.ts`(导出)
- Create: `web/app/api/tts/voices/route.ts`(合并清单)
- Modify: `web/app/admin/generate/page.tsx`(下拉改拉接口,删硬编码 TTS_VOICE_OPTIONS)、`web/app/api/tts/preview/route.ts`(校验用新规则)、`web/app/admin/models/page.tsx`(tts 提示补 customVoices 格式)
- Modify: `worker/src/gen/generateTts.ts`(readVoice 放宽)
- Test: 更新 `packages/db/src/ai/ttsVoices.test.ts`、`packages/db/src/ai/tts.test.ts`(或 volcanoTts.test.ts)、`worker/src/gen/generateTts.test.ts`

**Interfaces:**
```ts
// ttsVoices.ts 追加(内置白名单命中,或形如合法音色id:字母数字._-,3..64,含火山克隆 S_ 开头)
export function isPlausibleVoiceId(id: unknown): id is string {
  return typeof id === 'string' && /^[A-Za-z0-9_.-]{3,64}$/.test(id)
}
```
- `GET /api/tts/voices`(operator)→ `{ voices: {id,label}[] }` = 内置 TTS_VOICES + tts 能力 `extra.customVoices`(数组,元素须 `{id:合法id, label:非空串}` 否则跳过),按 id 去重(内置优先)。

- [ ] **Step 1: 失败测试**:
  - tts.ts/volcano:speaker `S_abc123` → `volcanoTtsSynthesize` 收到 `resourceId:'seed-icl-2.0'` 且 `emotionText:undefined`(即便 extra.emotion 配了);普通音色行为不变(mock volcanoTtsSynthesize 断言入参)。`extra.cloneResourceId` 可覆盖。
  - `isPlausibleVoiceId`:`S_x9-K.z` 过;`'ab'`(短)/含空格/中文/65长 拒。
  - readVoice:内置 id 过;`S_abc123` 过;`'乱 填'` 拒。
- [ ] **Step 2: 实现**:tts.ts 火山分支改:
```ts
const isClone = speaker.startsWith('S_')
return volcanoTtsSynthesize({
  ..., 
  resourceId: isClone ? ((cfg.extra.cloneResourceId as string) || 'seed-icl-2.0') : (cfg.model || 'seed-tts-2.0'),
  emotionText: isClone ? undefined : ((cfg.extra.emotion as string) || undefined),
})
```
readVoice:`isValidVoice(voice) || isPlausibleVoiceId(voice) ? voice : undefined`(注意保持返回 trim 前原值一致性,照现实现)。
- [ ] **Step 3: voices 接口 + 前端下拉**:route 读 `getCapabilityConfig('tts')` 的 extra.customVoices 合并;生成页 `useEffect` 拉取填充下拉(拉取失败回退内置清单需要——**内置清单从 `@mixcut/db` 导入 TTS_VOICES,顺带删除硬编码镜像**,消灭两处同步问题);preview 路由校验改 `isValidVoice(v) || isPlausibleVoiceId(v)`(仍 operator+限流)。
- [ ] **Step 4: models 页提示**:tts 提示文案追加:「克隆音色:火山声音复刻2.0 克隆得 S_ 开头音色ID,填入 extra 的 customVoices(如 `{"customVoices":[{"id":"S_xxx","label":"我的对标男声"}]}`)即出现在生成页」。
- [ ] **Step 5: 验证+提交** 全绿 → `feat(tts): 火山克隆音色路由 seed-icl-2.0 + customVoices 免改码添加音色`

---

## Task 5:BGM 批量上传 + 改名 + 文件夹

**Files:**
- Create: `packages/db/prisma/migrations/20260804130000_bgm_name_folder/migration.sql`(`ALTER TABLE "bgm_library" ADD COLUMN IF NOT EXISTS "name" TEXT; ADD COLUMN IF NOT EXISTS "folder" TEXT;`)+ schema.prisma BgmLibrary 加 `name String?` / `folder String?`
- Modify: `web/app/api/bgm/route.ts`(多文件+name/folder)、`web/app/api/bgm/[id]/route.ts`(加 PATCH)
- Modify: `web/app/admin/bgm/page.tsx`(多选上传/分组/行内改名)
- Test: `web/app/api/bgm/route.test.ts`(若无则新建轻量;或纯函数化文件名→name 的工具并单测)

- [ ] **Step 1: 迁移**:两库 `migrate deploy` + `prisma generate`。
- [ ] **Step 2: POST 多文件**:`const files = form.getAll('files').filter(f => f instanceof File)`;为空时兼容旧 `form.get('file')` 单文件;逐个校验音频扩展名(整单失败前不落盘);`name = path.basename(file.name, ext)`,`folder = form.get('folder')||null`;逐个建记录,返回数组。
- [ ] **Step 3: PATCH**:body `{ name?, folder?, styleTag? }`(至少一项),trim,空串→null(folder/styleTag),name 空串→400。
- [ ] **Step 4: 页面**:上传 input 加 `multiple` + 文件夹输入;列表按 folder 分组(null 归「未分组」);行内点名字变输入框改名(PATCH),folder 可改。
- [ ] **Step 5: 验证+提交** 全绿 → `feat(bgm): 批量上传+名字(默认文件名)+文件夹分组与改名`

---

## Self-Review
- 覆盖 spec 五项;F2 分配规则按"顺序不重复、不足回退 AI"落定(spec 中"循环"字样以本计划为准)。
- 类型一致:pickAssetsForSegments/readAssetSource(T2)只在 worker 用;isPlausibleVoiceId(T4)db 导出、web/worker 共用;POST students role 字面量与 requireRole 的 'operator' 一致。
- 迁移均 IF NOT EXISTS/加列,幂等;两库都要 deploy(全局约束已列)。
- YAGNI:视频素材不进渲染;克隆走控制台;不做素材去重/搜索;BGM 不做拖拽排序。
