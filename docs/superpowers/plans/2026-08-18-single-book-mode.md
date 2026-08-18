# 单本书成片 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 学员填一个书名，成片口播从头到尾只讲这一本；开场快闪仍连闪多本书封，最后一张定格在主题书。

**Architecture:** `select-books` 把主题书排到 `variables.books` 末位并单独写入 `variables.themeBook`；`generateScript` 见到 `themeBook` 就走新的单本提示词、所有正文段的《书名》头统一为主题书；`resolveBooks` 改为 `variables.books` 优先，保证快闪顺序不被框架自带书目绕开。

**Tech Stack:** TypeScript、vitest、Prisma、`@mixcut/db`

设计文档：`docs/superpowers/specs/2026-08-18-single-book-mode-design.md`

## Global Constraints

- 测试命令统一带库：`DATABASE_URL="postgresql://mixcut:mixcut@127.0.0.1:55433/mixcut_test?schema=public" npx vitest run <路径>`
- **禁止 `Math.random()`**：本仓随机一律由 `genTaskId` 派生的确定性随机源驱动。
- 提交前用 **Python 按字节扫描**确认源码无裸 NUL 字节；**不要用 `grep $'\x00'`**——它在 shell 里会退化成空模式匹配一切文件，是假阳性。
- 不新增数据库字段（`themeBook` 落在既有 `variables` Json 里）、不改渲染层、不改模板参数契约。
- **零回归三条路径**：运营手填书单（`hasManualBooks`）、`scriptMode==='manual'`、`scriptMode==='imitate'`。这三条都不产生 `themeBook`，必须与今天行为完全一致。
- 上一批的「书序号|文案」标记机制原样保留给多本路径，本批不得删除或改变其行为。
- 中文项目，注释与文档用中文。
- 集成测试务必保留 `afterAll` 清理，共享测试库不得留孤儿数据。

---

### Task 1: `select-books` 主题书排末位并写 `themeBook`

**Files:**
- Modify: `worker/src/gen/selectBooks.ts:274-280`（`writeBooksAndEnqueue`）、`:321-330`（主流程尾部）
- Test: `worker/src/gen/selectBooks.test.ts`（既有文件，追加 describe 块）

**Interfaces:**
- Produces: `variables.books` 末位为主题书；`variables.themeBook = { title, author?, points? }` 与末位那本内容一致

- [ ] **Step 1: 写失败测试**

先读 `worker/src/gen/selectBooks.test.ts` 既有的 mock 与夹具构造，沿用同一套写法，在文件末尾追加：

```ts
describe('selectBooks：单本模式——主题书排末位并单独标出', () => {
  it('主题书位于 variables.books 末位，themeBook 与之一致', async () => {
    // 构造：__bookCount = 3，学员填「被讨厌的勇气」，书库/联网提供 2 本陪衬书
    // 断言：
    //   books.length === 3
    //   books[books.length - 1].title === '被讨厌的勇气'
    //   themeBook.title === '被讨厌的勇气'
    //   books.slice(0, -1) 里不含「被讨厌的勇气」
  })

  it('__bookCount 为 1 时只有主题书，themeBook 仍写入', async () => {
    // 断言：books.length === 1 且 books[0] === themeBook；不调用候选池（llmComplete 调用次数不含推荐/校验）
  })

  it('运营手填书单 → 不写 themeBook（多本路径零回归）', async () => {
    // hasManualBooks 命中，直接入队；断言 variables.themeBook 为 undefined
  })

  it('mock 模式 → 主题书同样在末位并写 themeBook', async () => {
    // 沿用既有 mock 夹具；断言末位与 themeBook 一致
  })
})
```

**测试要有鉴别力**：断言必须能区分「排在首位」与「排在末位」。若只断言 `books` 包含主题书，改动前也会通过——那样的测试没有价值。

- [ ] **Step 2: 跑测试确认失败**

Run: `DATABASE_URL="postgresql://mixcut:mixcut@127.0.0.1:55433/mixcut_test?schema=public" npx vitest run worker/src/gen/selectBooks.test.ts`
Expected: FAIL —— 主题书当前在 `books[0]`，末位断言失败；`themeBook` 为 `undefined`

- [ ] **Step 3: 实现**

改 `writeBooksAndEnqueue` 接受可选主题书并写入：

```ts
// themeBook 是下游判定「走单本文案」的唯一信号，且同时承载单本提示词与《书名》头所需的
// 书名/作者/要点——用一个字段兼任信号与数据，避免开关与数据两处失配。
// 不传（运营手填书单、manual/imitate、老任务重跑）时不写该字段，下游维持多本路径。
async function writeBooksAndEnqueue(
  genTaskId: string,
  variables: unknown,
  books: BookOut[],
  themeBook?: BookOut,
): Promise<void> {
  const vars: Record<string, unknown> =
    variables && typeof variables === 'object' && !Array.isArray(variables) ? { ...(variables as Record<string, unknown>) } : {}
  vars.books = books
  if (themeBook) vars.themeBook = themeBook
  await prisma.generationTask.update({ where: { id: genTaskId }, data: { variables: vars as never } })
  await enqueueGen('generate-script', { genTaskId })
}
```

主流程尾部改为主题书排末位：

```ts
  // 快闪按 variables.books 顺序出卡，主题书排末位 = 最后一张定格在它。
  let books: BookOut[] = [studentBook]
  if (n > 1) {
    const pool = await collectCandidates(theme, studentBook, n)
    const picked = pickSubset(pool, n - 1, genTaskId)
    books = [...picked, studentBook]
  }

  await writeBooksAndEnqueue(genTaskId, task.variables, books, studentBook)
```

mock 分支同样要传主题书。读 `buildMockBookList` 的实现，确认其产出中哪一本对应学员输入，把它挪到末位并作为 `themeBook` 传入；若该函数不区分，就让 mock 分支构造 `{ title: subject }` 作为主题书排末位。**改完要把 `buildMockBookList` 的实际产出打印出来贴进报告**，不要凭推断改。

- [ ] **Step 4: 跑测试确认通过**

Run: 同 Step 2
Expected: PASS，且该文件既有测试全绿

- [ ] **Step 5: 提交**

```bash
git add worker/src/gen/selectBooks.ts worker/src/gen/selectBooks.test.ts
git commit -m "feat(books): 主题书排到书封末位并写入 variables.themeBook"
```

---

### Task 2: `resolveBooks` 改为 `variables.books` 优先

**Files:**
- Modify: `worker/src/gen/generateImage.ts:23-36`
- Test: `worker/src/gen/generateImage.covers.test.ts`（既有文件，追加）

**Interfaces:**
- Produces: `resolveBooks(overlayTemplate, variables)` —— `variables.books` 非空时用它，否则回退 `overlayTemplate.books`

- [ ] **Step 1: 写失败测试**

在 `worker/src/gen/generateImage.covers.test.ts` 追加：

```ts
describe('resolveBooks —— variables.books 优先', () => {
  it('两者都有时用 variables.books（per-generation 比框架默认值更具体）', () => {
    const out = resolveBooks(
      { books: [{ title: '框架原书', author: '原作者' }] },
      { books: [{ title: '本次选书甲' }, { title: '本次主题书', author: '某作者' }] },
    )
    expect(out.map((b) => b.title)).toEqual(['本次选书甲', '本次主题书'])
  })

  it('variables.books 为空 → 回退框架书目', () => {
    expect(resolveBooks({ books: [{ title: '框架原书' }] }, { books: [] }).map((b) => b.title)).toEqual(['框架原书'])
    expect(resolveBooks({ books: [{ title: '框架原书' }] }, {}).map((b) => b.title)).toEqual(['框架原书'])
  })

  it('两者皆空 → 空数组', () => {
    expect(resolveBooks({}, {})).toEqual([])
  })

  it('脏项（无 title / title 空白）被过滤，顺序不变', () => {
    const out = resolveBooks({}, { books: [{ title: '甲' }, { title: '  ' }, { author: '无题' }, { title: '乙' }] })
    expect(out.map((b) => b.title)).toEqual(['甲', '乙'])
  })
})
```

若 `resolveBooks` 未在该测试文件 import，加入既有 import 语句。

- [ ] **Step 2: 跑测试确认失败**

Run: `DATABASE_URL="postgresql://mixcut:mixcut@127.0.0.1:55433/mixcut_test?schema=public" npx vitest run worker/src/gen/generateImage.covers.test.ts`
Expected: FAIL —— 第一条得到 `['框架原书']`

- [ ] **Step 3: 实现**

把 `worker/src/gen/generateImage.ts` 的注释与返回改为：

```ts
// 取书单：variables.books 优先，回退 overlayTemplate.books；过滤无 title 的脏项。
// 顺序在此**必须原样保留**——快闪书封按该顺序出卡，主题书排在末位即「最后一张定格」。
// 早前是框架书目优先，会让本次选出的书单（含主题书末位顺序）被整个绕开；框架自带书目
// 的定位是「原片信息，仅供参考」，不该压过 per-generation 的选择。
```

返回改为 `const fromVars = pick(variables); return fromVars.length ? fromVars : pick(overlayTemplate)`。

- [ ] **Step 4: 跑测试确认通过**

Run: 同 Step 2 + `npx vitest run worker/src/gen/`
Expected: PASS，`worker/src/gen/` 全绿

- [ ] **Step 5: 提交**

```bash
git add worker/src/gen/generateImage.ts worker/src/gen/generateImage.covers.test.ts
git commit -m "fix(gen): resolveBooks 改为 variables.books 优先,保住书封顺序"
```

---

### Task 3: `buildSingleBookPrompt` 单本提示词

**Files:**
- Modify: `worker/src/gen/generateScript.ts`（在 `buildImitatePrompt` 之后新增）
- Test: `worker/src/gen/generateScript.singleBook.test.ts`（新建）

**Interfaces:**
- Consumes: 既有的 `styleRules(hasOpenTitle)`、`ScriptFrameworkInput`、`BookInput`
- Produces:
  ```ts
  export function buildSingleBookPrompt(args: {
    book: BookInput
    framework: ScriptFrameworkInput
    angle?: string
    openTitleText?: string
  }): string
  ```

- [ ] **Step 1: 写失败测试**

新建 `worker/src/gen/generateScript.singleBook.test.ts`：

```ts
import { describe, it, expect } from 'vitest'
import { buildSingleBookPrompt } from './generateScript'

const framework = { frameworkText: '框架示例：开头钩子+逐段展开', segCount: 7, maxLines: 21, maxTotalChars: 220 }
const book = { title: '被讨厌的勇气', author: '岸见一郎、古贺史健', points: '课题分离' }

describe('buildSingleBookPrompt', () => {
  it('含书名、作者、要点', () => {
    const p = buildSingleBookPrompt({ book, framework })
    expect(p).toContain('被讨厌的勇气')
    expect(p).toContain('岸见一郎、古贺史健')
    expect(p).toContain('课题分离')
  })

  it('硬性约束：只讲这一本，不得提及其他书籍', () => {
    const p = buildSingleBookPrompt({ book, framework })
    expect(p).toContain('只讲')
    expect(p).toContain('不得提及')
  })

  it('传 openTitleText 时要求首段以「今天分享的是《书名》」开场', () => {
    const p = buildSingleBookPrompt({ book, framework, openTitleText: '今天分享的是' })
    expect(p).toContain('今天分享的是《被讨厌的勇气》')
    expect(p).toContain('开场白')
    expect(p).toContain('开场白之后的第一句直击情绪')
    expect(p).not.toContain('开篇第一句直击情绪')
  })

  it('不传 openTitleText 时风格准则用原文首条', () => {
    const p = buildSingleBookPrompt({ book, framework })
    expect(p).toContain('开篇第一句直击情绪')
    expect(p).not.toContain('开场白')
  })

  it('不含书序号格式要求（单本无需标记）', () => {
    for (const p of [
      buildSingleBookPrompt({ book, framework }),
      buildSingleBookPrompt({ book, framework, openTitleText: '今天分享的是' }),
    ]) {
      expect(p).not.toContain('书序号')
    }
  })

  it('无作者/无要点时不输出空字段', () => {
    const p = buildSingleBookPrompt({ book: { title: '某书' }, framework })
    expect(p).toContain('某书')
    expect(p).not.toContain('作者：')
    expect(p).not.toContain('要点：')
  })

  it('带 angle 时进入提示词', () => {
    expect(buildSingleBookPrompt({ book, framework, angle: '故事式' })).toContain('故事式')
  })

  it('条目编号连续无重号', () => {
    for (const p of [
      buildSingleBookPrompt({ book, framework }),
      buildSingleBookPrompt({ book, framework, angle: '故事式', openTitleText: '今天分享的是' }),
    ]) {
      const nums = p.split('\n').map((l) => /^(\d+)\. /.exec(l)?.[1]).filter(Boolean).map(Number)
      expect(nums).toEqual(nums.map((_, i) => i + 1))
    }
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `DATABASE_URL="postgresql://mixcut:mixcut@127.0.0.1:55433/mixcut_test?schema=public" npx vitest run worker/src/gen/generateScript.singleBook.test.ts`
Expected: FAIL —— `buildSingleBookPrompt is not a function`

- [ ] **Step 3: 实现**

在 `buildImitatePrompt` 之后新增（沿用同文件既有的「数组拼装 + 统一编号」写法，避免条件项插入导致重号）：

```ts
/**
 * 纯函数：单本书成片的提示词。与 buildScriptPrompt 的 books 模式的根本区别是——
 * 全篇只讲一本书，因此不需要「书序号|文案」标记（只有一本，标记没有意义，多一条格式
 * 指令只会增加模型出错面）。调性由 frameworkText 决定，不在此写死风格词。
 */
export function buildSingleBookPrompt(args: {
  book: BookInput
  framework: ScriptFrameworkInput
  angle?: string
  openTitleText?: string
}): string {
  const { book, framework, angle, openTitleText } = args
  const { frameworkText, segCount, maxLines, maxTotalChars } = framework
  const openTitle = (openTitleText ?? '').trim()

  const bookLine = [`《${book.title}》`]
  if (book.author) bookLine.push(`作者：${book.author}`)
  if (book.points) bookLine.push(`要点：${book.points}`)

  const items = [
    ...(openTitle ? [`第一段必须是开场白，以「${openTitle}《${book.title}》」开头。`] : []),
    `分成 ${segCount} 段，每段单独一行，段与段之间用换行分隔。`,
    // 核心约束：模型写书评时天然爱旁征博引，不明说必犯。
    `全篇只讲《${book.title}》这一本书，不得提及、引用或对比任何其他书籍，也不得出现其他书名。`,
    '只输出文案正文，不要编号、不要标题、不要任何解释说明。',
    `总字数不超过 ${maxTotalChars} 字，总行数不超过 ${maxLines} 行。`,
    '严禁照搬书籍简介原文，必须围绕给定要点原创改写。',
    ...(angle ? [`本条整体采用「${angle}」的切入角度展开，与其它角度明显区分。`] : []),
  ]

  return [
    '你是一名书单号短视频文案写手。请根据下面的「文案框架」，为下面这一本书创作一条口播文案。',
    '',
    `文案框架：\n${frameworkText}`,
    `书籍：${bookLine.join(' ｜ ')}`,
    '',
    '要求：',
    ...items.map((s, i) => `${i + 1}. ${s}`),
    '',
    styleRules(Boolean(openTitle)),
  ].join('\n')
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: 同 Step 2
Expected: PASS（8 条）

- [ ] **Step 5: 提交**

```bash
git add worker/src/gen/generateScript.ts worker/src/gen/generateScript.singleBook.test.ts
git commit -m "feat(script): 新增单本书提示词,硬性约束不得提及其他书籍"
```

---

### Task 4: `generateScript` 单本路径接线

**Files:**
- Modify: `worker/src/gen/generateScript.ts`（新增 `readThemeBook`；主流程 `:362-386` 与 `:443-446`）
- Test: `worker/src/gen/generateScript.singleBook.test.ts`（追加集成 describe 块）

**Interfaces:**
- Consumes: Task 3 的 `buildSingleBookPrompt`、Task 1 写入的 `variables.themeBook`
- Produces: `export function readThemeBook(variables: unknown): BookInput | undefined`

- [ ] **Step 1: 写失败测试**

在 `generateScript.singleBook.test.ts` 追加集成测试。**mock 与夹具沿用 `worker/src/gen/generateScript.align.test.ts` 的写法**（含 `afterAll` 清理），覆盖：

```ts
// 1) variables.themeBook 存在 → 所有正文段 bookTitle/bookAuthor 均为主题书；
//    且发给 LLM 的 prompt 不含 variables.books 里其他陪衬书的书名。
//    构造：variables = { books: [{title:'陪衬甲'},{title:'陪衬乙'},{title:'被讨厌的勇气',author:'岸见一郎'}],
//                       themeBook: {title:'被讨厌的勇气',author:'岸见一郎'} }
//    断言：segments.every(s => s.bookTitle === '被讨厌的勇气' && s.bookAuthor === '岸见一郎')
//         prompt 不含 '陪衬甲'、不含 '陪衬乙'
//         prompt 不含 '书序号'
//
// 2) themeBook 缺失 → 走多本路径，行为与今天一致（书序号标记仍生效）。
//    构造：只有 variables.books 三本、无 themeBook，LLM 返回带标记的文案
//    断言：bookTitle 按标记分配，非全部相同
//
// 3) scriptMode='imitate' 且有 themeBook → 仍走仿写路径（themeBook 不得劫持 manual/imitate）。
//    断言：prompt 含参考文案、不含单本提示词特征串「不得提及」
//
// 4) 运营手填书单（有 books、无 themeBook）→ 多本路径，零回归。
```

**测试要有鉴别力**：第 1 条必须断言「prompt 不含陪衬书名」——这是最容易被漏掉的泄漏点（见下方实现说明）。

- [ ] **Step 2: 跑测试确认失败**

Run: `DATABASE_URL="postgresql://mixcut:mixcut@127.0.0.1:55433/mixcut_test?schema=public" npx vitest run worker/src/gen/generateScript.singleBook.test.ts`
Expected: FAIL —— 第 1 条得到按位置均分/标记分配的多个不同 bookTitle，且 prompt 含陪衬书名

- [ ] **Step 3: 实现**

新增读取器（放在 `readBookTitle` 旁）：

```ts
/**
 * 从 variables 读单本模式的主题书。存在即表示本次生成走「全篇只讲一本」的路径。
 * 由 select-books 写入；运营手填书单、manual/imitate、老任务重跑都不会有该字段。
 */
export function readThemeBook(variables: unknown): BookInput | undefined {
  const v = variables && typeof variables === 'object' && !Array.isArray(variables)
    ? (variables as Record<string, unknown>).themeBook : undefined
  if (!v || typeof v !== 'object' || Array.isArray(v)) return undefined
  const o = v as { title?: unknown; author?: unknown; points?: unknown }
  if (typeof o.title !== 'string' || !o.title.trim()) return undefined
  return {
    title: o.title.trim(),
    ...(typeof o.author === 'string' && o.author.trim() ? { author: o.author.trim() } : {}),
    ...(typeof o.points === 'string' && o.points.trim() ? { points: o.points.trim() } : {}),
  }
}
```

主流程里，在 `const perGenBookTitle = ...` 之后加：

```ts
  // 单本模式：仅 auto 文案模式生效。manual/imitate 是用户自控文案，themeBook 不得劫持它们。
  const themeBook = scriptMode === 'auto' ? readThemeBook(task.variables) : undefined
```

basePrompt 选择改为三分支：

```ts
    const basePrompt = scriptMode === 'imitate'
      ? buildImitatePrompt({ ... })                                  // 保持不变
      : themeBook
        ? buildSingleBookPrompt({ book: themeBook, framework: { frameworkText: fw.frameworkText, segCount, maxLines, maxTotalChars }, angle, openTitleText })
        : buildScriptPrompt({ ... })                                 // 保持不变
```

**关键泄漏点**：`buildScriptPrompt` 的 subject 分支会把 `variablesText`（整个 variables 的 JSON）拼进提示词，而 `variables.books` 里是陪衬书。`buildSingleBookPrompt` **不接收也不拼 `variablesText`**，正是为此——务必不要"顺手"把它传进去，否则陪衬书名会经 JSON 泄漏进单本提示词，模型就会去讲它们，本设计的核心约束当场失效。

书序号解析的开关要把单本排除（单本不要求标记）：

```ts
    const bookCount = mode === 'books' && !themeBook ? (books?.length ?? 0) : 0
```

最后的《书名》头分配改为单本优先：

```ts
  // 单本模式：所有正文段统一挂主题书，不走位置均分、也不走书序号标记。
  const assigned = themeBook
    ? clean.map((scriptText) => ({
        scriptText,
        bookTitle: themeBook.title,
        ...(themeBook.author ? { bookAuthor: themeBook.author } : {}),
      }))
    : assignBooksToSegments(clean, booksForAssign(scriptMode, books), markedIdxs ?? undefined)
```

`perGenBookTitle` 的覆盖逻辑保持在其后不变（运营显式指定书名仍最高优先）。

- [ ] **Step 4: 跑测试确认通过**

Run: `DATABASE_URL="postgresql://mixcut:mixcut@127.0.0.1:55433/mixcut_test?schema=public" npx vitest run worker/src/gen/` 与 `npx tsc --noEmit -p worker/tsconfig.json`
Expected: 全绿、exit 0

- [ ] **Step 5: 提交**

```bash
git add worker/src/gen/generateScript.ts worker/src/gen/generateScript.singleBook.test.ts
git commit -m "feat(script): 单本模式接线,正文段书名头统一为主题书"
```

---

### Task 5: 终验与文档

**Files:**
- Modify: `docs/superpowers/specs/2026-08-18-single-book-mode-design.md`（状态改「已实现」，补实现与设计的差异）
- Modify: `docs/2026-08-06-开发交付说明.md`（若其中描述了「AI 配齐到模板本数」的产品形态，同步更正为单本模式）

- [ ] **Step 1: 全量测试**

Run: `DATABASE_URL="postgresql://mixcut:mixcut@127.0.0.1:55433/mixcut_test?schema=public" npx vitest run`
Expected: 全绿。**已知偶发**：`web/app/api/admin/students/[id]/route.test.ts > 禁用最后一名可用运营 → 400` 属既有共享测试库串扰（约 1/3 概率），与本批无关；若只有它红，复跑一次确认，并在报告中如实注明，**不得据此声称"全绿"**。

- [ ] **Step 2: 类型检查与构建**

Run: `npx tsc --noEmit -p worker/tsconfig.json && npm run build -w web`
Expected: 均 exit 0。注意 `npm run build -w web` 输出里的 "Dynamic server usage ... cookies" 是本仓一贯的预渲染提示，不是失败——以 exit code 为准。

- [ ] **Step 3: 裸 NUL 字节检查**

```bash
python3 - <<'EOF'
import subprocess
files=subprocess.run(['git','ls-files','-z'],capture_output=True).stdout.split(b'\0')
bad=[n.decode() for n in files if n and n.decode().endswith(('.ts','.tsx')) and b'\x00' in open(n.decode(),'rb').read()]
print("含裸NUL的 .ts/.tsx:", len(bad), bad)
EOF
```
Expected: `0 []`

- [ ] **Step 4: 端到端冒烟**

写一次性集成测试（放 `worker/src/gen/` 下，跑完立即删除并确认 `git status` 干净——放 scratchpad 会导致 `@mixcut/db` 解析失败）：以 `__bookCount=4` 的 flash 框架 + 学员填「被讨厌的勇气」跑通 `selectBooks()` → `generateScript()` 全链路（LLM 用 mock），打印：

1. `variables.books` 的完整书名顺序（确认主题书在末位）
2. `variables.themeBook`
3. 发给 LLM 的完整单本提示词
4. 落库各段的 `scriptText` 与 `bookTitle`

**把这四项的实际输出原文贴进报告**，不要只写"符合预期"。特别核对：提示词里不含任何陪衬书名。

- [ ] **Step 5: 更新文档并提交**

```bash
git add docs/
git commit -m "docs: 单本书成片落地说明"
```
