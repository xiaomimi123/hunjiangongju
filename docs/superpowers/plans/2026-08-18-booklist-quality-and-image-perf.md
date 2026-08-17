# 选书质量修正 + 图片加载优化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修正线上首跑暴露的三个选书缺陷（学员书无作者 / 同书重复 / 主题标签不可复用）；把图片加载从「每次全量下大图」改为「小图 + 长期缓存」。

**Architecture:** 选书侧改 `bookPick.ts` 纯函数 + `selectBooks.ts` 兜底链；图片侧新增 ffmpeg 缩略图封装（worker 与 web 各一份薄封装，容器内均已装 ffmpeg），文件接口加缓存/304，页面优先小图并在 404 时回退原图。**不新增数据库字段、不改渲染层、不改模板参数。**

**Tech Stack:** TypeScript monorepo（web Next.js / worker BullMQ / packages/db `@mixcut/db`），Prisma + Postgres，ffmpeg，vitest。

设计依据：`docs/superpowers/specs/2026-08-18-booklist-quality-and-image-perf-design.md`（含线上首跑的真实输出数据）。

## Global Constraints

- 测试：`DATABASE_URL=postgresql://mixcut:mixcut@localhost:55433/mixcut_test?schema=public npx vitest run`（dev postgres：`docker compose -p mixcut -f docker-compose.yml -f docker-compose.dev.yml up -d postgres`）。
- **web 代码的真实类型检查是 `npm run build -w web`**；`tsc -p worker/tsconfig.json` 只覆盖 worker+packages，**不得**用它充当 web 文件的验证。
- **零回归铁律**：既有测试断言一律不改；运营手填书单路径、渲染层输出、模板参数不受影响。
- `packages/db` 内部相对 import **不带**扩展名；`worker/templates/booklist/*.ts` 带 `.js`。类型若供下游消费，须同时从 `packages/db/src/index.ts` 导出（本仓多次因此返工）。
- **分隔符/控制字符一律写转义（如 `'\x00'`），禁止裸控制字节**；每个改动过的文件提交前做字节级自查（python3 扫 `< 0x20`，排除 tab/LF/CR）并在报告中给出结果。本仓已因裸 NUL 返工三次。
- 随机源仅由 `genTaskId` 派生，禁止 `Math.random()`。
- 测试清理用 per-file tracked ids，禁止全表 `deleteMany({})`。
- 缩略图/缓存改动**不得**让主流程失败：ffmpeg 失败仅记 warning，前端 404 回退原图。
- 中文注释与提交信息，末尾带 `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`。
- 已知无关偶发：`web/app/api/admin/students/[id]/route.test.ts`（共享测试库状态）。不要"修"它。

---

### Task 1: `isSameBook` 与去重合并（纯函数）

**Files:**
- Modify: `packages/db/src/booklist/bookPick.ts`
- Modify: `packages/db/src/index.ts`
- Test: `packages/db/src/booklist/bookPick.test.ts`（扩展）

**Interfaces:**
- Produces：
  ```ts
  /** 同一本书判定：规范化书名后一方是另一方的「副标题前缀」，且作者一致或一方为空 */
  export function isSameBook(a: PickedBook, b: PickedBook): boolean
  ```
  `dedupeBooks` 改用它，并在合并时**保留信息更全的一条**（有作者优先于无作者；同为有/无作者时，有 points 优先），且**保持首次出现的位置**。
- Task 2 消费 `isSameBook`。

- [ ] **Step 1: 写失败测试**

```ts
describe('isSameBook', () => {
  it('副标题前缀 + 一方作者为空 → 同一本', () => {
    expect(isSameBook(
      { title: '被讨厌的勇气', author: '' },
      { title: '被讨厌的勇气：自我启发之父阿德勒的哲学课', author: '岸见一郎、古贺史健' },
    )).toBe(true)
  })
  it('副标题前缀 + 作者一致 → 同一本', () => {
    expect(isSameBook(
      { title: '活着', author: '余华' },
      { title: '活着（新版）', author: '余华' },
    )).toBe(true)
  })
  it('前缀但无副标题分隔符 → 不同书（防误吞）', () => {
    expect(isSameBook({ title: '活着', author: '余华' }, { title: '活着之上', author: '阎连科' })).toBe(false)
    expect(isSameBook({ title: '活着', author: '' }, { title: '活着之上', author: '' })).toBe(false)
  })
  it('作者明确不同 → 不同书', () => {
    expect(isSameBook(
      { title: '哈姆雷特', author: '莎士比亚' },
      { title: '哈姆雷特：注释本', author: '朱生豪' },
    )).toBe(false)
  })
  it('完全同名同作者 → 同一本', () => {
    expect(isSameBook({ title: '《活着》', author: ' 余华 ' }, { title: '活着', author: '余华' })).toBe(true)
  })
  it('毫不相干 → 不同书', () => {
    expect(isSameBook({ title: 'A', author: '甲' }, { title: 'B', author: '乙' })).toBe(false)
  })
})

describe('dedupeBooks 合并同一本书', () => {
  it('短名无作者 + 全名有作者 → 只留一条,取信息更全者,位置不变', () => {
    const out = dedupeBooks([
      { title: '被讨厌的勇气', author: '' },
      { title: '活出生命的意义', author: '弗兰克尔' },
      { title: '被讨厌的勇气：自我启发之父阿德勒的哲学课', author: '岸见一郎、古贺史健', points: 'X' },
    ])
    expect(out).toHaveLength(2)
    expect(out[0]).toEqual({ title: '被讨厌的勇气：自我启发之父阿德勒的哲学课', author: '岸见一郎、古贺史健', points: 'X' })
    expect(out[1].title).toBe('活出生命的意义')
  })
  it('两条都有作者时保留先出现的', () => {
    const out = dedupeBooks([
      { title: '活着', author: '余华', points: '先' },
      { title: '活着：新版', author: '余华', points: '后' },
    ])
    expect(out).toHaveLength(1)
    expect(out[0].points).toBe('先')
  })
  it('不同书不合并（回归）', () => {
    expect(dedupeBooks([{ title: '活着', author: '余华' }, { title: '活着之上', author: '阎连科' }])).toHaveLength(2)
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `DATABASE_URL=... npx vitest run packages/db/src/booklist/bookPick.test.ts`

- [ ] **Step 3: 实现**

`isSameBook` 要点（写在 `bookPick.ts`，纯函数、不抛错）：
```ts
// 副标题分隔符：全名版书名通常是「主标题<分隔符>副标题」。只有在分隔符处截断才算同一本，
// 否则「活着」会误吞「活着之上」。
const SUBTITLE_SEP = /^[：:—\-（(\s]/
export function isSameBook(a: PickedBook, b: PickedBook): boolean {
  if (!a || !b || typeof a.title !== 'string' || typeof b.title !== 'string') return false
  const ta = normalizeTitle(a.title), tb = normalizeTitle(b.title)
  if (!ta || !tb) return false
  const aa = (a.author ?? '').trim(), ab = (b.author ?? '').trim()
  // 作者都非空且不同 → 直接判为不同书（同名不同作者是不同版本/不同书）
  if (aa && ab && aa !== ab) return false
  if (ta === tb) return true
  const [short, long] = ta.length <= tb.length ? [ta, tb] : [tb, ta]
  if (!long.startsWith(short)) return false
  return SUBTITLE_SEP.test(long.slice(short.length))
}
```
`dedupeBooks` 改为：对每个候选，先在已收结果里找 `isSameBook` 命中项；命中则按「信息更全」决定是否替换（有作者 > 无作者；作者同档时有 points > 无 points；仍同档保留先出现者），未命中则追加。**保持位置不变**（替换时原地替换，不移到末尾）。

`index.ts` 追加导出 `isSameBook`。

- [ ] **Step 4: 跑测试确认通过 + 全量回归 + tsc**

- [ ] **Step 5: 字节自查 + 提交** `feat(books): 同一本书判定(副标题前缀)与去重合并保留信息更全者`

---

### Task 2: 学员书作者三级兜底 + 主题词

**Files:**
- Modify: `worker/src/gen/selectBooks.ts`
- Test: `worker/src/gen/selectBooks.test.ts`（扩展）

**Interfaces:**
- Consumes：Task 1 的 `isSameBook`。
- Produces：`resolveStudentBook` 行为变化 + 新增导出纯函数
  ```ts
  /** 从查证响应里解析「作者|主题词」；取不到主题词时 theme 为 undefined */
  export function parseVerifiedBook(raw: string): { author?: string; theme?: string }
  ```

- [ ] **Step 1: 写失败测试（纯函数）**

```ts
describe('parseVerifiedBook', () => {
  it('解析 作者|主题词', () => {
    expect(parseVerifiedBook('岸见一郎、古贺史健|自我成长')).toEqual({ author: '岸见一郎、古贺史健', theme: '自我成长' })
  })
  it('只有作者(无分隔符) → 仅 author', () => {
    expect(parseVerifiedBook('余华')).toEqual({ author: '余华' })
  })
  it('NO / 空 → 空对象', () => {
    expect(parseVerifiedBook('NO')).toEqual({})
    expect(parseVerifiedBook('   ')).toEqual({})
  })
  it('主题词过长时丢弃主题词但保留作者', () => {
    const long = '这是一个非常长的主题描述超过限制'
    expect(parseVerifiedBook(`余华|${long}`)).toEqual({ author: '余华' })
  })
  it('去掉包裹的书名号/引号与首尾空白', () => {
    expect(parseVerifiedBook(' 「余华」 | 「文学」 ')).toEqual({ author: '余华', theme: '文学' })
  })
})
```

- [ ] **Step 2: 写失败测试（selectBooks 行为）**

按该文件既有写法（mock `llmComplete`、真实测试库、tracked ids）新增：
```
1. 学员书查证第一次失败、第二次成功 → 作者取到，只调用两次查证
2. 两次都失败 → 从候选池里按 isSameBook 命中的全名版取作者（断言最终 books[0].author 非空）
3. 三级都拿不到 → author 为 '' 且该书未写入 BookLibrary（断言 count 为 0）
4. 查证返回「作者|主题词」→ 写库与后续召回都用主题词，而非 subject
5. 查证只返回作者 → theme 回退为 subject（保持现状,不硬失败）
6. 学员书仍固定排第一（回归）
```

- [ ] **Step 3: 跑测试确认失败 → 实现**

要点：
- `buildVerifySubjectPrompt` 改为要求 `作者|主题词` 格式（主题词 2–6 字），并明确「无法确认回复 NO」。
- `resolveStudentBook(subject, candidates)` 新增第二参数（候选池，可为空数组）；三级兜底：
  1. 查证 →（失败或无作者）**重试一次**
  2. 仍无 → `candidates.find(c => isSameBook({title: subject, author: ''}, c))` 取其 author/points
  3. 仍无 → `{ title, author: '' }`，**不写库**
- 有作者时 `upsertBook(..., theme: theme ?? subject)`。
- **调用顺序调整**：现状是先 `resolveStudentBook` 再 `collectCandidates`。为让第 2 级能用上候选池，改为先收候选、再解析学员书；或在拿到候选后对学员书做一次补作者。选任一实现，但**必须保证学员书仍排第一**，且**运营手填/mock/scriptMode 跳过三条早退路径不受影响**。
- 主题词用于 `collectCandidates(theme, ...)` 的召回与写库。

- [ ] **Step 4: 跑测试确认通过 + 全量回归 + tsc**

- [ ] **Step 5: 字节自查 + 提交** `fix(gen): 学员书作者三级兜底;主题词独立于选题`

---

### Task 3: 文件接口缓存与 304

**Files:**
- Modify: `web/app/api/files/[...path]/route.ts`
- Test: `web/app/api/files/[...path]/route.test.ts`（新建；无既有测试则按 `web/app/api/admin/assets/route.test.ts` 的鉴权 mock 与 NextRequest 约定写）

**Interfaces:**
- Produces：GET 响应新增 `Cache-Control: private, max-age=31536000, immutable`、`ETag`、`Last-Modified`；命中 `If-None-Match` 或 `If-Modified-Since` 返回 `304`（无响应体）。

- [ ] **Step 1: 写失败测试**

覆盖：
```
1. 200 响应带 ETag、Last-Modified、Cache-Control 且含 private 与 immutable
2. 带匹配的 If-None-Match → 304，且响应体为空
3. 带不匹配的 If-None-Match → 200 完整内容
4. If-Modified-Since 晚于 mtime → 304
5. Range 请求仍返回 206 且 Content-Range 正确(回归)，同样带 ETag
6. 未登录且无 sig → 401（回归，鉴权不得被缓存逻辑绕过）
```
**注意**：304 判定必须在鉴权之后——未登录请求即便带 `If-None-Match` 也必须 401，不能靠条件请求绕过登录。测试要覆盖这一点。

- [ ] **Step 2: 跑测试确认失败 → 实现**

- ETag 由 `size` 与 `mtimeMs` 派生（如 `W/"<size>-<mtimeMs>"`），弱校验即可。
- `Cache-Control` **必须含 `private`**：这些资源需登录访问，不可进共享缓存。
- 条件请求判定放在鉴权与路径校验之后、读文件之前。
- Range 分支同样带上 `ETag`/`Cache-Control`。

- [ ] **Step 3: 验证**：新测试绿 + 全量回归 + `npm run build -w web` 成功。

- [ ] **Step 4: 字节自查 + 提交** `perf(web): 文件接口加长期缓存与 304 协商`

---

### Task 4: 缩略图生成（worker 生成图 + web 素材上传）

**Files:**
- Create: `worker/src/thumb.ts`
- Create: `web/lib/thumb.ts`
- Modify: `worker/src/gen/generateImage.ts`
- Modify: `web/app/api/admin/assets/route.ts`
- Test: `worker/src/thumb.test.ts`

**Interfaces:**
- Produces（两份同签名薄封装，各自所在包内使用）：
  ```ts
  /** 生成 <原图同目录>/<basename>.thumb.webp（宽 360 等比）。失败仅记 warning,不抛错 */
  export async function makeThumb(srcAbs: string): Promise<boolean>
  /** 由原图 URL 推导缩略图 URL：/api/files/gen/x/3.png → /api/files/gen/x/3.thumb.webp */
  export function thumbUrl(originalUrl: string): string
  ```
  `thumbUrl` 供 Task 5 的页面使用——放在 web 侧（`web/lib/thumb.ts`）导出即可，页面是客户端组件，**不得**从 `@mixcut/db` 引。

- [ ] **Step 1: 写失败测试（worker/src/thumb.test.ts）**

```
1. thumbUrl 推导正确（.png/.jpg/.jpeg/.webp 各一例；无扩展名时原样返回）
2. makeThumb 对一张真实小图（测试内用 ffmpeg 现场生成一张纯色 png 作输入）产出 .thumb.webp 且文件存在、体积 > 0
3. makeThumb 对不存在的路径 → 返回 false，不抛错
4. 生成的缩略图宽度为 360（用 ffprobe 读取验证）
```
测试产生的临时文件放到系统临时目录并在 afterAll 清理，**不得**写进仓库或 `data/`。

- [ ] **Step 2: 跑测试确认失败 → 实现**

ffmpeg 命令形如：`ffmpeg -y -i <src> -vf scale=360:-2 -quality 78 <dst>`（沿用本仓 `worker/src/ffmpeg.ts` 既有的 spawn/封装风格）。失败一律 `console.warn` + 返回 false。

- [ ] **Step 3: 接线**

- `generateImage.ts`：`await fs.writeFile(abs, png)` 之后调用 `makeThumb(abs)`；素材库命中分支（复制素材文件）同样调用。**用 try/catch 包住，绝不影响生成流程。**
- `web/app/api/admin/assets/route.ts`：批量上传每个文件落盘后调用 web 侧 `makeThumb`。同样不得让上传失败。

- [ ] **Step 4: 验证**：新测试绿 + 全量回归 + `npm run build -w web` 成功 + `npx tsc --noEmit -p worker/tsconfig.json` exit 0。

- [ ] **Step 5: 字节自查 + 提交** `perf: 生成图与素材上传同时产出缩略图`

---

### Task 5: 页面改用缩略图（含 404 回退）

**Files:**
- Modify: `web/app/admin/generate/[id]/page.tsx`
- Modify: `web/app/admin/generate/[id]/edit/page.tsx`
- Modify: `web/app/admin/assets/page.tsx`

**Interfaces:**
- Consumes：Task 4 的 `thumbUrl`（`web/lib/thumb.ts`）。

- [ ] **Step 1: 实现**

三处网格/预览的 `<img src>` 改为 `thumbUrl(原图URL)`，并加 `onError` 回退原图（旧任务无缩略图时）：
```tsx
<img
  src={thumbUrl(src)}
  onError={(e) => { const el = e.currentTarget; if (el.src !== absoluteOriginal) el.src = src }}
  loading="lazy"
  ...
/>
```
要点：
- 回退只做一次，避免原图也 404 时进入无限重试循环（用一个标记或比较 src）。
- 加 `loading="lazy"`，长列表只加载视口内的图。
- **编辑页重新生成单段后的 `?t=` 时间戳必须同时带到缩略图 URL 上**，否则改完图看到的还是旧缩略图。
- 点开看大图的入口（若有）仍用原图。

- [ ] **Step 2: 验证**：`npm run build -w web` 成功 + 全量回归绿。页面无测试框架，改动须保持足够简单以便评审通过阅读确认。

- [ ] **Step 3: 字节自查 + 提交** `perf(web): 列表与预览改用缩略图并懒加载`

---

### Task 6: 终验 + 真实链路冒烟 + 文档

**Files:**
- Modify: `README.md`、`docs/superpowers/specs/2026-08-18-booklist-quality-and-image-perf-design.md`（状态改「已实现」）

- [ ] **Step 1: 选书冒烟（mock 模式，不发网络）**

临时脚本（repo 根、`npx tsx`、用完删）：构造与线上首跑同形的场景——学员书查证失败、候选池里存在全名版——跑 `selectBooks`，打印 `variables.books`。断言并粘贴输出：
- 学员那本**有作者**（来自全名版）
- **不存在重复的同一本书**（短名与全名不同时出现）
- 书目数 = 目标本数

- [ ] **Step 2: 缓存与缩略图冒烟**

脚本对 `/api/files` 同一路径请求两次（第二次带首次返回的 `ETag`），打印两次的状态码与响应头，确认 `200 → 304`。再对一张真实生成图调用 `makeThumb`，打印原图与缩略图的字节数与压缩比。粘贴输出。

- [ ] **Step 3: 终验**

```
DATABASE_URL=postgresql://mixcut:mixcut@localhost:55433/mixcut_test?schema=public npx vitest run
npx tsc --noEmit -p worker/tsconfig.json
npm run build -w web
```

- [ ] **Step 4: 文档**：README 补一句图片缓存/缩略图行为（部署后旧任务无缩略图会自动回退原图，属预期）；设计文档状态改「已实现」，并更正任何与最终实现不符的描述。

- [ ] **Step 5: 字节自查 + 提交** `docs: 选书质量与图片性能说明`
