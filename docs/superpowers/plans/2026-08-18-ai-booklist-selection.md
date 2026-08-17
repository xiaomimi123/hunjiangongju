# AI 选书 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 学员选一个模板、只填一个「选题（书名或主题）」，系统自动配齐真实存在的书目（书名+作者经查证），生成每次都不同的文案与配图，模板不变。

**Architecture:** 新增流水线步骤 `select-books`（置于 `generate-script` 之前），产出写进 `task.variables.books`——与运营手填书单**同一形状**，因此下游文案/《书名》头/flash 书封全部零改动。真实性靠「书库命中优先 + 百炼联网检索 + 二次校验 + 通过者沉淀入库」。

**Tech Stack:** TypeScript monorepo（web Next.js / worker BullMQ / packages/db `@mixcut/db`），Prisma + Postgres，vitest。

设计依据：`docs/superpowers/specs/2026-08-18-ai-booklist-selection-design.md`。

## Global Constraints

- 测试：`DATABASE_URL=postgresql://mixcut:mixcut@localhost:55433/mixcut_test?schema=public npx vitest run`（dev postgres：`docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d postgres`）。每任务跑相关测试 + `npx tsc --noEmit -p worker/tsconfig.json` exit 0；触 web 的任务加 `npm run build -w web`。
- **零回归铁律**：运营手填书单路径、渲染层输出、既有测试断言一律不得改变。既有断言若变红，改实现不改断言。
- `packages/db` 内部相对 import **不带**扩展名；`worker/templates/booklist/*.ts` 相对 import **带** `.js`。类型若供下游消费，须同时从 `packages/db/src/index.ts` 与（若 worker 模板层需要）`worker/templates/booklist/templateParams.ts` 导出——这条在上一批次连续两次被漏掉。
- 纯函数不抛错、逐块 try/catch 降级，沿用 `parseJianyingDraft.ts` 既有风格。
- **mock 模式必须自带 fixture**：新增的每个 LLM 能力都要在 `isMockMode` 下返回自己的固定结果，**不得**经由 `llmComplete` 的通用 mock（那返回的是无关文案）。
- 迁移文件用 `CREATE TABLE IF NOT EXISTS`，命名 `<UTC时间戳>_add_book_library`，并同时应用到 `mixcut` 与 `mixcut_test` 两个库。
- 随机源一律由 `genTaskId` 派生（同任务重跑稳定、不同任务必不同），复用 `seedInt` 式字符码累加写法，**禁止** `Math.random()`。
- 中文注释、中文提交信息，末尾带 `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`。

---

### Task 1: `llmComplete` 支持 temperature 与联网检索

**Files:**
- Modify: `packages/db/src/ai/llm.ts`
- Modify: `packages/db/src/ai/types.ts`（`LlmOpts` 加字段）
- Test: `packages/db/src/ai/llm.test.ts`（无则新建）

**Interfaces:**
- Produces：`llmComplete(opts)` 新增两个可选入参
  ```ts
  interface LlmOpts { prompt: string; system?: string; maxTokens?: number; temperature?: number; enableSearch?: boolean }
  ```
  - `temperature` 存在时作为顶层 `temperature` 传给 `/chat/completions`；缺省时**不传该字段**（保持现状默认）。
  - `enableSearch === true` 时顶层加 `enable_search: true`（百炼 OpenAI 兼容端点按顶层参数接收）；缺省不传。
- 后续 Task 3/4 依赖这两个入参。

- [ ] **Step 1: 写失败测试**

用 `vi.stubGlobal('fetch', ...)` 捕获请求体（该仓已有 route 测试用 vi.mock 的先例；此处直接 stub fetch 即可）。测试需先设 `AI_MOCK` 为非 '1' 并 stub `getCapabilityConfig`——若 stub 成本过高，改为把 body 组装抽成纯函数 `buildLlmBody(cfg, opts)` 并只测它（更简单，推荐）。按后者写：

```ts
import { describe, it, expect } from 'vitest'
import { buildLlmBody } from './llm'

const cfg = { model: 'qwen-plus' } as never

describe('buildLlmBody', () => {
  it('缺省不带 temperature 与 enable_search（保持现状默认）', () => {
    const b = buildLlmBody(cfg, { prompt: 'x' })
    expect('temperature' in b).toBe(false)
    expect('enable_search' in b).toBe(false)
    expect(b.max_tokens).toBe(2000)
  })
  it('传 temperature → 顶层带上', () => {
    expect(buildLlmBody(cfg, { prompt: 'x', temperature: 0.9 }).temperature).toBe(0.9)
  })
  it('enableSearch=true → 顶层 enable_search:true', () => {
    expect(buildLlmBody(cfg, { prompt: 'x', enableSearch: true }).enable_search).toBe(true)
  })
  it('enableSearch=false → 不带该字段（不发 false，避免覆盖服务端默认）', () => {
    expect('enable_search' in buildLlmBody(cfg, { prompt: 'x', enableSearch: false })).toBe(false)
  })
  it('system 存在时 messages 首条为 system', () => {
    const b = buildLlmBody(cfg, { prompt: 'p', system: 's' })
    expect(b.messages[0]).toEqual({ role: 'system', content: 's' })
  })
})
```

- [ ] **Step 2: 跑测试确认失败**（`buildLlmBody` 未导出）

- [ ] **Step 3: 实现**

`types.ts` 的 `LlmOpts` 加 `temperature?: number` 与 `enableSearch?: boolean`。
`llm.ts` 抽出并导出：

```ts
/** 组装 /chat/completions 请求体。temperature/enable_search 仅在显式给出时才带上——
 *  缺省一律不传，保持与改动前逐字节一致的请求体（既有生成行为不受影响）。 */
export function buildLlmBody(cfg: { model: string }, opts: LlmOpts): Record<string, unknown> {
  return {
    model: cfg.model,
    messages: [
      ...(opts.system ? [{ role: 'system', content: opts.system }] : []),
      { role: 'user', content: opts.prompt },
    ],
    max_tokens: opts.maxTokens ?? 2000,
    ...(typeof opts.temperature === 'number' ? { temperature: opts.temperature } : {}),
    ...(opts.enableSearch === true ? { enable_search: true } : {}),
  }
}
```
`llmComplete` 改为 `body: JSON.stringify(buildLlmBody(cfg, opts))`，其余不动。

- [ ] **Step 4: 跑测试确认通过 + 全量回归 + tsc**

- [ ] **Step 5: 提交** `feat(llm): llmComplete 支持 temperature 与百炼联网检索`

---

### Task 2: 书库表 + 迁移 + 读写函数

**Files:**
- Modify: `packages/db/prisma/schema.prisma`
- Create: `packages/db/prisma/migrations/20260818120000_add_book_library/migration.sql`
- Create: `packages/db/src/booklist/bookLibrary.ts`
- Modify: `packages/db/src/index.ts`
- Test: `packages/db/src/booklist/bookLibrary.test.ts`

**Interfaces:**
- Produces：
  ```ts
  export interface BookRow { id: string; title: string; author: string; theme: string | null; points: string | null; source: string }
  /** 精确命中（书名 trim 后完全相同，忽略书名号）；命中返回该条，否则 null */
  export function findBookByTitle(title: string): Promise<BookRow | null>
  /** 按主题标签召回候选（theme 相等），最多 limit 条 */
  export function findBooksByTheme(theme: string, limit: number): Promise<BookRow[]>
  /** 幂等写入：同 (title, author) 已存在则返回既有行，不重复插入 */
  export function upsertBook(b: { title: string; author: string; theme?: string; points?: string; source?: string }): Promise<BookRow>
  ```
- Task 3 消费全部三个。

- [ ] **Step 1: schema + 迁移**

`schema.prisma` 追加：
```prisma
model BookLibrary {
  id        String   @id @default(uuid())
  title     String
  author    String
  theme     String?
  points    String?
  source    String   @default("ai")
  createdAt DateTime @default(now()) @map("created_at")
  @@unique([title, author])
  @@map("book_library")
}
```
迁移 SQL（幂等）：
```sql
CREATE TABLE IF NOT EXISTS "book_library" (
  "id" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "author" TEXT NOT NULL,
  "theme" TEXT,
  "points" TEXT,
  "source" TEXT NOT NULL DEFAULT 'ai',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "book_library_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "book_library_title_author_key" ON "book_library"("title", "author");
```
应用到两个库：
```
DATABASE_URL=postgresql://mixcut:mixcut@localhost:55433/mixcut npx prisma migrate deploy --schema packages/db/prisma/schema.prisma
DATABASE_URL=postgresql://mixcut:mixcut@localhost:55433/mixcut_test npx prisma migrate deploy --schema packages/db/prisma/schema.prisma
npx prisma generate --schema packages/db/prisma/schema.prisma
```

- [ ] **Step 2: 写失败测试**

清理用 per-file tracked ids，**禁止**全表 `deleteMany({})`（测试库表与并行用例共享）：

```ts
import { describe, it, expect, afterAll } from 'vitest'
import { findBookByTitle, findBooksByTheme, upsertBook } from './bookLibrary'
import { prisma } from '../client'   // 按该目录既有 import 客户端的写法调整

const ids: string[] = []
afterAll(async () => { await prisma.bookLibrary.deleteMany({ where: { id: { in: ids } } }) })

describe('bookLibrary', () => {
  it('upsert 幂等：同书名+作者第二次返回既有行', async () => {
    const a = await upsertBook({ title: '被讨厌的勇气', author: '岸见一郎', theme: '心理' }); ids.push(a.id)
    const b = await upsertBook({ title: '被讨厌的勇气', author: '岸见一郎', theme: '心理' })
    expect(b.id).toBe(a.id)
    expect(await prisma.bookLibrary.count({ where: { title: '被讨厌的勇气', author: '岸见一郎' } })).toBe(1)
  })
  it('findBookByTitle 忽略书名号与首尾空白', async () => {
    const a = await upsertBook({ title: '活着', author: '余华' }); ids.push(a.id)
    expect((await findBookByTitle(' 《活着》 '))?.id).toBe(a.id)
  })
  it('findBookByTitle 未命中 → null', async () => {
    expect(await findBookByTitle('不存在的书名XYZ')).toBeNull()
  })
  it('findBooksByTheme 按主题召回并受 limit 限制', async () => {
    for (const t of ['主题书A', '主题书B', '主题书C']) {
      const r = await upsertBook({ title: t, author: '作者X', theme: '测试主题' }); ids.push(r.id)
    }
    expect((await findBooksByTheme('测试主题', 2)).length).toBe(2)
  })
})
```

- [ ] **Step 3: 跑测试确认失败 → 实现 → 确认通过**

`bookLibrary.ts` 要点：书名规范化 `title.replace(/[《》]/g, '').trim()` 后比较（存库存原始 trim 后的书名，查询时对两侧都做规范化——**实现方式**：库里存规范化后的书名，展示时再加书名号，避免查询要做函数索引）。`upsertBook` 用 `prisma.bookLibrary.upsert` 配合唯一约束。

`index.ts` 追加导出（不带扩展名）：
```ts
export { findBookByTitle, findBooksByTheme, upsertBook } from './booklist/bookLibrary'
export type { BookRow } from './booklist/bookLibrary'
```

- [ ] **Step 4: 全量回归 + tsc**

- [ ] **Step 5: 提交** `feat(books): 书库表与读写函数`

---

### Task 3: `select-books` 步骤（纯函数部分）

**Files:**
- Create: `packages/db/src/booklist/bookPick.ts`
- Modify: `packages/db/src/index.ts`
- Test: `packages/db/src/booklist/bookPick.test.ts`

**Interfaces:**
- Produces（Task 4 与 Task 5 消费）：
  ```ts
  export interface PickedBook { title: string; author: string; points?: string }
  /** 稳定随机源：同 seed 必得同结果 */
  export function seedFrom(seed: string): number
  /** 从候选里按 seed 抽 n 本并打乱顺序；候选 <= n 时返回全部（仍按 seed 排序） */
  export function pickSubset<T>(candidates: T[], n: number, seed: string): T[]
  /** 文案切入角度池 */
  export const ANGLES: string[]
  export function pickAngle(seed: string): string
  /** 解析 LLM 返回的书目 JSON；容忍代码围栏；剔除缺书名/作者的条目 */
  export function parseBookList(raw: string): PickedBook[]
  /** 合并候选并按 (规范化书名+作者) 去重，先来先留 */
  export function dedupeBooks(list: PickedBook[]): PickedBook[]
  /** 目标本数：__bookCount → books.length → 5，clamp 到 1..20 */
  export function resolveBookCount(overlayTemplate: unknown): number
  ```

- [ ] **Step 1: 写失败测试**

```ts
import { describe, it, expect } from 'vitest'
import { seedFrom, pickSubset, pickAngle, ANGLES, parseBookList, dedupeBooks, resolveBookCount } from './bookPick'

describe('稳定随机', () => {
  it('同 seed 结果一致，异 seed 结果不同', () => {
    const xs = Array.from({ length: 10 }, (_, i) => i)
    expect(pickSubset(xs, 3, 'task-a')).toEqual(pickSubset(xs, 3, 'task-a'))
    expect(pickSubset(xs, 3, 'task-a')).not.toEqual(pickSubset(xs, 3, 'task-b'))
  })
  it('候选不足时返回全部', () => {
    expect(pickSubset([1, 2], 5, 's').sort()).toEqual([1, 2])
  })
  it('pickAngle 取自角度池且同 seed 稳定', () => {
    expect(ANGLES).toContain(pickAngle('t1'))
    expect(pickAngle('t1')).toBe(pickAngle('t1'))
  })
  it('seedFrom 非负', () => { expect(seedFrom('任意')).toBeGreaterThanOrEqual(0) })
})

describe('parseBookList', () => {
  it('解析合法 JSON 数组', () => {
    expect(parseBookList('[{"title":"活着","author":"余华","points":"苦难与坚韧"}]'))
      .toEqual([{ title: '活着', author: '余华', points: '苦难与坚韧' }])
  })
  it('剥掉代码围栏', () => {
    expect(parseBookList('```json\n[{"title":"平凡的世界","author":"路遥"}]\n```'))
      .toEqual([{ title: '平凡的世界', author: '路遥' }])
  })
  it('剔除缺书名或作者的条目', () => {
    expect(parseBookList('[{"title":"只有书名"},{"author":"只有作者"},{"title":"完整","author":"甲"}]'))
      .toEqual([{ title: '完整', author: '甲' }])
  })
  it('垃圾输入 → 空数组，不抛错', () => {
    expect(parseBookList('抱歉我无法完成')).toEqual([])
    expect(parseBookList('')).toEqual([])
  })
  it('书名带《》时去掉', () => {
    expect(parseBookList('[{"title":"《活着》","author":"余华"}]')).toEqual([{ title: '活着', author: '余华' }])
  })
})

describe('dedupeBooks', () => {
  it('同书名同作者只留一条，先来先留', () => {
    expect(dedupeBooks([
      { title: '活着', author: '余华', points: '第一条' },
      { title: '《活着》', author: '余华', points: '第二条' },
    ])).toEqual([{ title: '活着', author: '余华', points: '第一条' }])
  })
  it('同书名不同作者视为不同书', () => {
    expect(dedupeBooks([{ title: 'A', author: '甲' }, { title: 'A', author: '乙' }]).length).toBe(2)
  })
})

describe('resolveBookCount', () => {
  it('优先 __bookCount', () => { expect(resolveBookCount({ __bookCount: 13, books: [1, 2] })).toBe(13) })
  it('回退 books.length', () => { expect(resolveBookCount({ books: [1, 2, 3] })).toBe(3) })
  it('都没有 → 5', () => { expect(resolveBookCount({})).toBe(5); expect(resolveBookCount(null)).toBe(5) })
  it('越界 clamp 到 1..20', () => {
    expect(resolveBookCount({ __bookCount: 0 })).toBe(1)
    expect(resolveBookCount({ __bookCount: 999 })).toBe(20)
  })
})
```

- [ ] **Step 2: 跑测试确认失败 → 实现 → 确认通过**

实现要点：`seedFrom` 用字符码累加（同 `theme.ts` 的 `seedInt`）；`pickSubset` 用 seed 派生的确定性洗牌（如线性同余推进，**不得** `Math.random()`）；`ANGLES` 至少含「金句式」「故事式」「痛点式」「对比式」「场景式」；规范化书名统一 `s.replace(/[《》]/g, '').trim()`。

- [ ] **Step 3: index.ts 导出 + 全量回归 + tsc**

- [ ] **Step 4: 提交** `feat(books): 选书纯函数(稳定随机/解析/去重/本数)`

---

### Task 4: `select-books` 流水线步骤（LLM 检索 + 验证 + 沉淀 + 兜底）

**Files:**
- Create: `worker/src/gen/selectBooks.ts`
- Modify: `worker/src/gen/index.ts`（注册 job）
- Modify: `packages/db/src/genQueue.ts`（job 名联合类型加 `select-books`）
- Modify: `web/app/api/generate/route.ts`（首个入队改为 `select-books`）
- Test: `worker/src/gen/selectBooks.test.ts`

**Interfaces:**
- Consumes：Task 1 的 `llmComplete({ enableSearch, temperature })`；Task 2 的书库三函数；Task 3 的纯函数。
- Produces：`export async function selectBooks(genTaskId: string): Promise<void>`——把结果写进 `task.variables.books`（形状 `{title, author, points?}[]`，与运营手填同形），随后 `enqueueGen('generate-script', { genTaskId })`。

- [ ] **Step 1: 写失败测试**

mock 模式为主（不发网络）。需要真实 DB 行做书库命中，用 tracked-id 清理。

```ts
// 关键用例（按该文件既有 worker 测试写法组织）：
// 1. mock 模式 → 返回固定夹具书目,不发网络,variables.books 被写入且长度 = 目标本数
// 2. 书库已有该书 → 不调用联网(用 spy 断言 llmComplete 未被以 enableSearch 调用)
// 3. 学员输入本身始终作为第一本出现（学员填什么就讲什么，不能被 AI 挤掉）
// 4. 目标本数 N 来自 framework.overlayTemplate.__bookCount
// 5. 兜底：LLM 全部失败 → variables.books 至少含学员输入那本，任务不 FAILED
// 6. 同一 genTaskId 重跑 → 结果一致；不同 genTaskId + 同 subject → 书单组合不同
// 7. 完成后入队 generate-script
```

- [ ] **Step 2: 跑测试确认失败 → 实现**

`selectBooks.ts` 结构（每块 try/catch，任一步失败都降级不抛）：

```
1. 读 task(含 framework) → subject、N = resolveBookCount(fw.overlayTemplate)
2. mock 模式 → 用自带 fixture 书目（不得走 llmComplete 通用 mock），写回并入队，结束
3. 学员输入解析：findBookByTitle(subject) 命中 → 直接用；未命中 → 带 enableSearch 查证该书(书名+作者)
   → 查证通过则 upsertBook 沉淀；查不到 → 以 subject 原文为书名、作者留空字符串继续（不阻断）
4. 候选池 = [学员那本] + findBooksByTheme(theme, N*2)
5. 不足 N → 带 enableSearch 让 LLM 推荐真实存在的同主题书（要求 JSON 数组）→ parseBookList → dedupeBooks
6. 对联网新增的每本做二次校验（同样 enableSearch，问「该书是否真实存在且作者是否为X」，要求只回 YES/NO）
   → 通过者 upsertBook 沉淀；不通过剔除
7. 最终 = pickSubset(候选去重后, N, genTaskId)，但**学员那本固定排第一**
8. 写回 task.variables.books（保留 variables 其余字段）→ enqueueGen('generate-script')
```

`genQueue.ts` 的 job 名联合类型加 `'select-books'`；`worker/src/gen/index.ts` 的 switch 加 `case 'select-books': return selectBooks(job.data.genTaskId)`；`web/app/api/generate/route.ts` 把 `enqueueGen('generate-script', ...)` 改为 `enqueueGen('select-books', ...)`。

**注意**：运营手填书单时（`variables.books` 已存在且非空）`selectBooks` 必须**原样跳过**，直接入队 generate-script——这是零回归的关键，须有测试覆盖。

- [ ] **Step 3: 跑测试确认通过 + 全量回归 + tsc + web build**

- [ ] **Step 4: 提交** `feat(gen): select-books 步骤(联网查证+书库沉淀+兜底)`

---

### Task 5: 拆掉框架书目顶替 + 文案差异化

**Files:**
- Modify: `worker/src/gen/generateScript.ts`
- Test: `worker/src/gen/generateScript.test.ts`（扩展）、`generateScript.mode.test.ts`（若相关）

**Interfaces:**
- Consumes：Task 3 的 `pickAngle`；Task 1 的 `temperature`。
- Produces：行为变化——框架 `overlayTemplate.books` 不再顶替；`buildScriptPrompt` 的 books 分支加入「切入角度」；LLM 调用带 `temperature`。

- [ ] **Step 1: 写失败测试**

```ts
// 1. 框架带 books、variables 无 books、mode=subject → 不再切到 books 模式采用框架书目
//    （断言提示词里不含框架书目的书名，且含 subject）
// 2. buildScriptPrompt(books 模式) 传入 angle → 提示词包含该角度词
// 3. 同 books 不同 angle → 提示词不同
// 4. 运营手填 books 的既有行为不变（现有断言必须原样通过）
```

- [ ] **Step 2: 跑测试确认失败 → 实现**

删除 `generateScript.ts` 里这段（连注释）：
```ts
  if (mode === 'subject') {
    const fwBooks = frameworkBooks(fw.overlayTemplate)
    if (fwBooks.length > 0) { mode = 'books'; books = fwBooks }
  }
```
`buildScriptPrompt` 的 args 加可选 `angle?: string`，books 分支在「要求」列表后追加一行 `5. 本条整体采用「${angle}」的切入角度展开，与其它角度明显区分。`（angle 缺省时不加该行，保证既有断言不变）。
`generateScript` 调用处传 `angle: pickAngle(genTaskId)`，并给 `llmComplete` 传 `temperature: 0.9`。

`frameworkBooks` 若因此无引用：**保留导出并保留其测试**（其它地方/未来展示仍可能用），仅去掉此处调用。

- [ ] **Step 3: 跑测试确认通过 + 全量回归 + tsc**

- [ ] **Step 4: 提交** `feat(gen): 框架书目不再顶替学员选题;文案加随机切入角度`

---

### Task 6: 书库后台接口与页面

**Files:**
- Create: `web/app/api/admin/books/route.ts`（GET 列表/带 theme 筛选、POST 新增）
- Create: `web/app/api/admin/books/[id]/route.ts`（PATCH 改、DELETE 删）
- Create: `web/app/admin/books/page.tsx`
- Modify: `web/components/admin/SidebarNav.tsx`（在「运营」组内加入口，追加式改动）
- Test: `web/app/api/admin/books/route.test.ts`、`web/app/api/admin/books/[id]/route.test.ts`

**Interfaces:**
- Consumes：Task 2 的表与函数（页面只经接口，不直接碰 prisma）。
- Produces：`GET /api/admin/books?theme=` → `{ books, themes }`；`POST` 建（title/author 必填，冲突 409）；`PATCH` 改；`DELETE` 删。全部 operator-only。

- [ ] **Step 1: 写失败测试**（鉴权约定、NextRequest 2 参调用、tracked-id 清理，全部照抄 `web/app/api/admin/assets/route.test.ts` 的写法）

覆盖：越权 403、缺书名/作者 400、正常新增、重复 (title,author) → 409、theme 筛选、PATCH 改主题、DELETE 删除、删不存在 → 404。

- [ ] **Step 2: 跑测试确认失败 → 实现 → 确认通过**

页面：列表（书名/作者/主题/来源）、主题筛选下拉、新增表单、行内改主题与要点、删除确认。样式沿用 `/admin/assets` 页的既有组件与类名。

- [ ] **Step 3: `npm run build -w web` + 全量回归 + tsc**

- [ ] **Step 4: 提交** `feat(web): 书库后台(增删改查+主题筛选)`

---

### Task 7: 学员端提示与选用书目展示

**Files:**
- Modify: `web/app/(student)/templates/page.tsx`
- Modify: `web/app/(student)/works/[id]/page.tsx`
- Modify: `web/app/api/works/[id]/route.ts`（若该接口未下发 variables.books，则补上；先读该文件确认）

**Interfaces:**
- Consumes：`task.variables.books`（Task 4 写入）。

- [ ] **Step 1: 实现**

- 选题输入框：`placeholder` 改为「填一个书名或主题，例如《被讨厌的勇气》或「治愈内耗」」，下方补一行小字说明「系统会自动配齐同主题的真实书目并生成文案」。
- 详情页：任务生成后展示「本条选用的书目」列表（书名+作者）；`variables.books` 为空时不显示该区块。
- 接口若未下发该字段，按最小改动补下发（**只下发 books，不要把整个 variables 暴露给学员**——里面可能有运营字段）。

- [ ] **Step 2: 验证**：`npm run build -w web` 成功 + 全量回归绿 + tsc exit 0。

- [ ] **Step 3: 提交** `feat(web): 学员端选题提示与选用书目展示`

---

### Task 8: 终验 + 真实链路冒烟 + 文档

**Files:**
- Modify: `README.md`、`docs/superpowers/specs/2026-08-18-ai-booklist-selection-design.md`（状态改「已实现」）

- [ ] **Step 1: mock 全链路冒烟**

写临时脚本（repo 根、`npx tsx`、用完删除）：用 mock 模式建一个 GenerationTask（框架带 `__bookCount: 3`、`overlayTemplate.books` 非空以验证不再顶替），跑 `selectBooks` → 打印 `variables.books`。断言：长度 3、第一本是 subject、**不含框架自带书目的书名**。粘贴输出到报告。

- [ ] **Step 2: 差异化验证**

同一 subject、两个不同 genTaskId 各跑一次 `selectBooks` + `buildScriptPrompt`，打印两者的角度与书单顺序，确认**不同**。粘贴输出。

- [ ] **Step 3: 终验**

```
DATABASE_URL=postgresql://mixcut:mixcut@localhost:55433/mixcut_test?schema=public npx vitest run
npx tsc --noEmit -p worker/tsconfig.json
npm run build -w web
```

- [ ] **Step 4: 文档**：README 补「AI 选书」一段（学员只填选题即可；书库在后台可维护）；设计文档状态改「已实现」。

- [ ] **Step 5: 提交** `docs: AI 选书说明`
