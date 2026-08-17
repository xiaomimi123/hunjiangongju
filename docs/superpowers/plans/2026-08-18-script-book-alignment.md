# 文案与画面对齐 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让《书名》头严格跟随文案内容（而非按段数均分），并让快闪模板的开场 4 秒有呼应的旁白。

**Architecture:** books 模式要求 LLM 逐行输出 `书序号|文案`；解析出的序号直接决定书名头，位置均分退为兜底。flash 模板把 `open.titleText` 喂进提示词，要求首行是开场白（序号 0）。全部改动集中在 `worker/src/gen/generateScript.ts`，渲染层/模板/数据库零改动。

**Tech Stack:** TypeScript、vitest、Prisma、`@mixcut/db`

设计文档：`docs/superpowers/specs/2026-08-18-script-book-alignment-design.md`

## Global Constraints

- 测试命令统一带库：`DATABASE_URL="postgresql://mixcut:mixcut@127.0.0.1:55433/mixcut_test?schema=public" npx vitest run <路径>`
- **禁止 `Math.random()`**：本仓随机一律由 `genTaskId` 派生的确定性随机源驱动。
- **分隔符常量必须写成显式转义**（如 `'\x00'`），提交前做裸 NUL 字节检查——曾有源码混入裸 `0x00` 导致 git 判定为二进制、代码评审静默失效。
- 不新增数据库字段、不改渲染层、不改模板参数契约。
- 回归红线：未传 `openTitleText` 时，风格准则段落与今天**逐字节相同**。（books 模式新增的书序号格式要求**不在**此红线内，属有意变化。）
- 不变式：`parseBookMarkedLines` 返回的每条 `text` 必须非空且已 trim。主流程依赖它保证 `trimToBudget` 裁剪后文案数组与序号数组仍配对。
- 中文项目，注释与文档用中文。

---

### Task 1: `parseBookMarkedLines` 纯函数

**Files:**
- Modify: `worker/src/gen/generateScript.ts`
- Test: `worker/src/gen/generateScript.bookMark.test.ts`（新建）

**Interfaces:**
- Consumes: 无
- Produces: `export type MarkedLine = { bookIdx: number; text: string }`；
  `export function parseBookMarkedLines(lines: string[], bookCount: number): MarkedLine[] | null`

- [ ] **Step 1: 写失败测试**

新建 `worker/src/gen/generateScript.bookMark.test.ts`：

```ts
import { describe, it, expect } from 'vitest'
import { parseBookMarkedLines } from './generateScript'

describe('parseBookMarkedLines', () => {
  it('全部行合法 → 解析出序号与文案', () => {
    expect(parseBookMarkedLines(['1|《活着》告诉你', '2|他靠想象活过一天'], 3)).toEqual([
      { bookIdx: 1, text: '《活着》告诉你' },
      { bookIdx: 2, text: '他靠想象活过一天' },
    ])
  })

  it('序号 0 表示开场白', () => {
    expect(parseBookMarkedLines(['0|今天分享的是五本书', '1|正文'], 2)).toEqual([
      { bookIdx: 0, text: '今天分享的是五本书' },
      { bookIdx: 1, text: '正文' },
    ])
  })

  it('全角竖线同样接受', () => {
    expect(parseBookMarkedLines(['1｜全角分隔'], 1)).toEqual([{ bookIdx: 1, text: '全角分隔' }])
  })

  it('序号与文案两侧空白被吃掉', () => {
    expect(parseBookMarkedLines(['  2 |  有空白  '], 2)).toEqual([{ bookIdx: 2, text: '有空白' }])
  })

  it('文案本身含竖线 → 只按首个分隔符切分', () => {
    expect(parseBookMarkedLines(['1|前|后'], 1)).toEqual([{ bookIdx: 1, text: '前|后' }])
  })

  it('空行被忽略，不影响解析', () => {
    expect(parseBookMarkedLines(['1|甲', '', '  ', '2|乙'], 2)).toEqual([
      { bookIdx: 1, text: '甲' },
      { bookIdx: 2, text: '乙' },
    ])
  })

  it('任一行缺标记 → 整体返回 null（全有或全无）', () => {
    expect(parseBookMarkedLines(['1|甲', '没有标记的一行', '2|乙'], 2)).toBeNull()
  })

  it('序号越界（大于书数）→ null', () => {
    expect(parseBookMarkedLines(['1|甲', '7|乙'], 5)).toBeNull()
  })

  it('分隔符后没有文案 → null', () => {
    expect(parseBookMarkedLines(['1|'], 1)).toBeNull()
  })

  it('全空输入 → null', () => {
    expect(parseBookMarkedLines(['', '   '], 3)).toBeNull()
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `DATABASE_URL="postgresql://mixcut:mixcut@127.0.0.1:55433/mixcut_test?schema=public" npx vitest run worker/src/gen/generateScript.bookMark.test.ts`
Expected: FAIL —— `parseBookMarkedLines is not a function` / 不存在该导出

- [ ] **Step 3: 实现**

在 `worker/src/gen/generateScript.ts` 中 `allocateBookIndexes` 之前插入：

```ts
export type MarkedLine = { bookIdx: number; text: string }

// 半角 | 与全角 ｜ 都接受：LLM 中文输出常给全角。
const BOOK_MARK_RE = /^\s*(\d+)\s*[|｜]\s*(.+)$/

/**
 * 纯函数：解析 LLM 按「书序号|文案」格式输出的行。
 * 全有或全无——任一非空行不匹配格式、或序号不在 0..bookCount，整体返回 null 表示须回退位置均分。
 * 半解析会产出比均分更难预料的错位，故不做部分采用。
 * 序号 0 = 开场白（无书名头）；序号 k = 第 k 本书。
 * 不变式：返回的每条 text 均非空且已 trim——主流程据此保证 trimToBudget 裁剪后
 * 文案数组与序号数组仍逐项配对（trimToBudget 内部会 filter(Boolean)，空串会让两者错位）。
 */
export function parseBookMarkedLines(lines: string[], bookCount: number): MarkedLine[] | null {
  const nonEmpty = lines.map((l) => l.trim()).filter(Boolean)
  if (nonEmpty.length === 0) return null
  const out: MarkedLine[] = []
  for (const line of nonEmpty) {
    const m = BOOK_MARK_RE.exec(line)
    if (!m) return null
    const bookIdx = Number(m[1])
    if (!Number.isInteger(bookIdx) || bookIdx < 0 || bookIdx > bookCount) return null
    const text = m[2].trim()
    if (!text) return null
    out.push({ bookIdx, text })
  }
  return out
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: 同 Step 2
Expected: PASS（10 条）

- [ ] **Step 5: 提交**

```bash
git add worker/src/gen/generateScript.ts worker/src/gen/generateScript.bookMark.test.ts
git commit -m "feat(script): 新增 parseBookMarkedLines 解析「书序号|文案」标记"
```

---

### Task 2: `assignBooksToSegments` 接受显式书序号

**Files:**
- Modify: `worker/src/gen/generateScript.ts:152-160`
- Test: `worker/src/gen/generateScript.test.ts`（既有文件，追加 describe 块）

**Interfaces:**
- Consumes: Task 1 的 `MarkedLine`（仅概念上，本任务只收 `number[]`）
- Produces: `assignBooksToSegments(lines: string[], books: BookInput[], bookIdxs?: number[]): AssignedSegment[]`
  —— 第三参为**1-based 书序号**数组（0 表示无书名头），长度须与 `lines` 相同，否则忽略并回退 `allocateBookIndexes`

- [ ] **Step 1: 写失败测试**

在 `worker/src/gen/generateScript.test.ts` 末尾追加：

```ts
describe('assignBooksToSegments —— 显式书序号', () => {
  const books = [
    { title: '甲书', author: '甲作者' },
    { title: '乙书', author: '乙作者' },
    { title: '丙书' },
  ]

  it('给定序号时按序号分配，不再按位置均分', () => {
    const out = assignBooksToSegments(['a', 'b', 'c', 'd'], books, [1, 2, 2, 3])
    expect(out.map((o) => o.bookTitle)).toEqual(['甲书', '乙书', '乙书', '丙书'])
    expect(out.map((o) => o.bookAuthor)).toEqual(['甲作者', '乙作者', '乙作者', undefined])
  })

  it('序号 0 → 该段无书名头（开场白）', () => {
    const out = assignBooksToSegments(['开场白', 'a'], books, [0, 1])
    expect(out[0].bookTitle).toBeUndefined()
    expect(out[1].bookTitle).toBe('甲书')
  })

  it('序号数组长度与行数不符 → 忽略之，回退位置均分', () => {
    const out = assignBooksToSegments(['a', 'b', 'c'], books, [1, 2])
    expect(out.map((o) => o.bookTitle)).toEqual(['甲书', '乙书', '丙书'])
  })

  it('不传序号时与今天完全一致', () => {
    expect(assignBooksToSegments(['a', 'b', 'c'], books))
      .toEqual(assignBooksToSegments(['a', 'b', 'c'], books, undefined))
  })

  it('书单为空时原样透传（不受序号影响）', () => {
    expect(assignBooksToSegments(['a', 'b'], [], [1, 2])).toEqual([{ scriptText: 'a' }, { scriptText: 'b' }])
  })
})
```

若 `assignBooksToSegments` 尚未在该测试文件 import，请加入既有 import 语句。

- [ ] **Step 2: 跑测试确认失败**

Run: `DATABASE_URL="postgresql://mixcut:mixcut@127.0.0.1:55433/mixcut_test?schema=public" npx vitest run worker/src/gen/generateScript.test.ts`
Expected: FAIL —— 第一条断言得到 `['甲书','甲书','乙书','丙书']`（位置均分结果），而非 `['甲书','乙书','乙书','丙书']`

- [ ] **Step 3: 实现**

把 `worker/src/gen/generateScript.ts` 的 `assignBooksToSegments` 替换为：

```ts
/**
 * 纯函数：结合书序号把书目的 title/author 落到每段文案上。
 * `bookIdxs` 给定（1-based，0=无书名头）且长度与 lines 相同时，按它分配——这是让《书名》头
 * 严格跟随文案内容的路径；未给定或长度不符时回退 `allocateBookIndexes` 的位置均分。
 * books 为空数组（subject 模式）时原样透传，不带 bookTitle/bookAuthor。
 */
export function assignBooksToSegments(
  lines: string[],
  books: BookInput[],
  bookIdxs?: number[],
): AssignedSegment[] {
  if (books.length === 0) return lines.map((scriptText) => ({ scriptText }))
  const idxs = bookIdxs && bookIdxs.length === lines.length
    ? bookIdxs.map((n) => (n >= 1 && n <= books.length ? n - 1 : -1))
    : allocateBookIndexes(lines.length, books.length)
  return lines.map((scriptText, i) => {
    const book = books[idxs[i]]
    if (!book) return { scriptText }
    return book.author ? { scriptText, bookTitle: book.title, bookAuthor: book.author } : { scriptText, bookTitle: book.title }
  })
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: 同 Step 2
Expected: PASS，且该文件既有测试全绿

- [ ] **Step 5: 提交**

```bash
git add worker/src/gen/generateScript.ts worker/src/gen/generateScript.test.ts
git commit -m "feat(script): assignBooksToSegments 支持显式书序号,位置均分退为兜底"
```

---

### Task 3: 提示词——书序号格式 + 开场白 + 风格准则条件化

**Files:**
- Modify: `worker/src/gen/generateScript.ts:66-120`
- Test: `worker/src/gen/generateScript.prompt.test.ts`（新建）

**Interfaces:**
- Consumes: 无
- Produces: `buildScriptPrompt(args: { mode; subject; books?; framework; variablesText?; angle?; openTitleText?: string }): string`

- [ ] **Step 1: 写失败测试**

新建 `worker/src/gen/generateScript.prompt.test.ts`：

```ts
import { describe, it, expect } from 'vitest'
import { buildScriptPrompt } from './generateScript'

const framework = { frameworkText: '框架示例', segCount: 7, maxLines: 21, maxTotalChars: 220 }
const books = [{ title: '甲书', author: '甲作者' }, { title: '乙书' }]

describe('buildScriptPrompt —— 书序号格式（books 模式）', () => {
  it('books 模式要求逐行输出「书序号|文案」，并说明序号范围', () => {
    const p = buildScriptPrompt({ mode: 'books', subject: '成长', books, framework })
    expect(p).toContain('书序号|文案')
    expect(p).toContain('1-2')
  })

  it('subject 模式没有书单可编号 → 不含书序号格式要求', () => {
    const p = buildScriptPrompt({ mode: 'subject', subject: '成长', framework })
    expect(p).not.toContain('书序号|文案')
  })
})

describe('buildScriptPrompt —— 开场白与风格准则', () => {
  it('传 openTitleText 时要求首行为开场白且序号写 0', () => {
    const p = buildScriptPrompt({ mode: 'books', subject: '成长', books, framework, openTitleText: '今天分享的是' })
    expect(p).toContain('今天分享的是')
    expect(p).toContain('开场白')
  })

  it('传 openTitleText 时风格准则首条改为「开场白之后」，不再是「开篇第一句」', () => {
    const p = buildScriptPrompt({ mode: 'books', subject: '成长', books, framework, openTitleText: '今天分享的是' })
    expect(p).toContain('开场白之后的第一句直击情绪')
    expect(p).not.toContain('开篇第一句直击情绪')
  })

  it('subject 模式同样支持开场白（开场白与有无书单无关）', () => {
    const p = buildScriptPrompt({ mode: 'subject', subject: '成长', framework, openTitleText: '今天分享的是' })
    expect(p).toContain('开场白')
  })

  it('回归红线：不传 openTitleText 时风格准则段落逐字节等于今天的原文', () => {
    const EXPECTED = [
      '文案风格准则（务必遵守）：',
      '- 开篇第一句直击情绪、给一个具体场景或画面，不要先介绍书或说"今天推荐"。',
      '- 短句、口语化、像跟朋友说话；多用具体细节，少用抽象大词。',
      '- 严禁"你是不是……"式营销开头、"不是……而是……"的对仗论证、机械排比。',
      '- 结尾留余味、给一句能被记住的话；严禁任何 CTA（买它/点购物车/关注/链接）。',
    ].join('\n')
    for (const p of [
      buildScriptPrompt({ mode: 'books', subject: '成长', books, framework }),
      buildScriptPrompt({ mode: 'subject', subject: '成长', framework }),
    ]) {
      expect(p).toContain(EXPECTED)
    }
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `DATABASE_URL="postgresql://mixcut:mixcut@127.0.0.1:55433/mixcut_test?schema=public" npx vitest run worker/src/gen/generateScript.prompt.test.ts`
Expected: FAIL —— 书序号/开场白相关断言全部找不到对应文本（最后一条回归断言应当已通过）

- [ ] **Step 3: 实现**

把 `worker/src/gen/generateScript.ts` 的 `STYLE_RULES` 常量替换为函数，并改造 `buildScriptPrompt`：

```ts
// 书单号爆款文案风格准则（对齐优质书单号：口语化、情绪优先、无营销腔）。
// hasOpenTitle=true 时首条必须让步：模板已有「今天分享的是」这类开场标题，
// 此时要求写开场白与原文「不要先介绍书」正面冲突，两条打架会让 LLM 输出不稳定。
function styleRules(hasOpenTitle: boolean): string {
  return [
    '文案风格准则（务必遵守）：',
    hasOpenTitle
      ? '- 开场白之后的第一句直击情绪、给一个具体场景或画面，不要先介绍书或说"今天推荐"。'
      : '- 开篇第一句直击情绪、给一个具体场景或画面，不要先介绍书或说"今天推荐"。',
    '- 短句、口语化、像跟朋友说话；多用具体细节，少用抽象大词。',
    '- 严禁"你是不是……"式营销开头、"不是……而是……"的对仗论证、机械排比。',
    '- 结尾留余味、给一句能被记住的话；严禁任何 CTA（买它/点购物车/关注/链接）。',
  ].join('\n')
}

export function buildScriptPrompt(args: {
  mode: 'books' | 'subject'
  subject: string
  books?: BookInput[]
  framework: ScriptFrameworkInput
  variablesText?: string
  angle?: string
  openTitleText?: string
}): string {
  const { mode, subject, books, framework, variablesText = '', angle, openTitleText } = args
  const { frameworkText, segCount, maxLines, maxTotalChars } = framework
  const openTitle = (openTitleText ?? '').trim()

  if (mode === 'books') {
    const list = (books ?? []).map(formatBookLine).join('\n')
    const n = books?.length ?? 0
    // 书序号让《书名》头严格跟随内容；开场白行用 0，不归属任何一本书。
    const openLine = openTitle
      ? `每一条文案单独一行，行首必须标出这句讲的是第几本书，格式为「书序号|文案」，书序号取上面书单的编号 1-${n}；第一行必须是开场白，以「${openTitle}」开头，用一句话点出这几本书共同解决的问题，这一行的书序号写 0。`
      : `每一条文案单独一行，行首必须标出这句讲的是第几本书，格式为「书序号|文案」，书序号取上面书单的编号 1-${n}。`
    return [
      '你是一名书单号短视频文案写手。请根据下面的「文案框架」，为以下书单逐句创作书评口吻的文案。',
      '',
      `文案框架：\n${frameworkText}`,
      `书单（共 ${n} 本）：\n${list}`,
      '',
      '要求：',
      `1. ${openLine}`,
      '2. 按书单顺序为每本书逐句撰写书评文案；语言需贴合书评人口吻，突出该书的核心价值与阅读理由。',
      '3. 除行首的「书序号|」外，只输出文案正文，不要编号、不要额外标题、不要任何解释说明。',
      `4. 总字数不超过 ${maxTotalChars} 字（不含行首书序号），总行数不超过 ${maxLines} 行，请依书目数量合理分配每本书的篇幅。`,
      '5. 严禁照搬书籍简介原文，必须围绕给定要点原创改写。',
      ...(angle ? [`6. 本条整体采用「${angle}」的切入角度展开，与其它角度明显区分。`] : []),
      '',
      styleRules(Boolean(openTitle)),
    ].join('\n')
  }

  // subject 分支的条目编号随开场白条目的有无整体顺延，故用数组拼装后统一编号，
  // 避免手写序号出现两个「3.」。
  const subjectItems = [
    '请先选书：在心里挑选 2-4 本与选题高度相关、适合书单号推荐的书籍（无需输出选书过程与书单本身），再围绕选定书目逐句撰写书评文案。',
    `分成 ${segCount} 段，每段单独一行，段与段之间用换行分隔。`,
    ...(openTitle ? [`第一段必须是开场白，以「${openTitle}」开头，用一句话点出这条视频要解决的问题。`] : []),
    '只输出文案正文，不要编号、不要标题、不要选书清单、不要任何解释说明。',
    `总字数不超过 ${maxTotalChars} 字，总行数不超过 ${maxLines} 行。`,
    '严禁照搬原文或框架示例，必须围绕选题原创改写。',
  ]
  return [
    '你是一名书单号短视频文案写手。请根据下面的「文案框架」和「选题」创作一条口播文案。',
    '',
    `文案框架：\n${frameworkText}`,
    `选题：${subject}${variablesText}`,
    '',
    '要求：',
    ...subjectItems.map((s, i) => `${i + 1}. ${s}`),
    '',
    styleRules(Boolean(openTitle)),
  ].join('\n')
}
```

books 分支同理：若嫌手写 `1.`–`6.` 易错，可用同样的数组 + `map` 统一编号，但**必须保证** angle 条目仍只在 `angle` 存在时出现。

- [ ] **Step 4: 跑测试确认通过**

Run: `DATABASE_URL="postgresql://mixcut:mixcut@127.0.0.1:55433/mixcut_test?schema=public" npx vitest run worker/src/gen/generateScript.prompt.test.ts worker/src/gen/generateScript.test.ts worker/src/gen/generateScript.mode.test.ts`
Expected: PASS（既有 prompt 相关断言若因编号变化而失败，只允许改测试里对**编号**的断言，不得放宽对内容的断言）

- [ ] **Step 5: 提交**

```bash
git add worker/src/gen/generateScript.ts worker/src/gen/generateScript.prompt.test.ts
git commit -m "feat(script): 提示词要求书序号标记与开场白,风格准则按模板条件化"
```

---

### Task 4: 主流程接线

**Files:**
- Modify: `worker/src/gen/generateScript.ts:233-307`（`generateScript` 主函数）
- Test: `worker/src/gen/generateScript.align.test.ts`（新建）

**Interfaces:**
- Consumes: Task 1 `parseBookMarkedLines`、Task 2 `assignBooksToSegments(_,_,bookIdxs?)`、Task 3 `buildScriptPrompt({ openTitleText })`
- Produces: 无新导出

- [ ] **Step 1: 写失败测试**

新建 `worker/src/gen/generateScript.align.test.ts`（mock 与夹具沿用 `worker/src/gen/generateScript.frameworkFallback.test.ts` 的写法）：

```ts
// 书名头改由 LLM 的书序号标记决定后，用 DB 集成测试驱动 generateScript() 全流程验证三件事：
// 标记生效、无标记时回退均分、标记在预算校验前被剥离。
import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest'

const mockLlmComplete = vi.fn()
const mockIsMockMode = vi.fn()
const mockGetCapabilityConfig = vi.fn()
const mockEnqueueGen = vi.fn()

vi.mock('@mixcut/db', async () => {
  const actual = await vi.importActual<typeof import('@mixcut/db')>('@mixcut/db')
  return {
    ...actual,
    llmComplete: (...args: unknown[]) => mockLlmComplete(...args),
    isMockMode: (...args: unknown[]) => mockIsMockMode(...args),
    getCapabilityConfig: (...args: unknown[]) => mockGetCapabilityConfig(...args),
    enqueueGen: (...args: unknown[]) => mockEnqueueGen(...args),
  }
})

import { prisma } from '@mixcut/db'
import { generateScript } from './generateScript'

const frameworkIds: string[] = []
const taskIds: string[] = []

afterAll(async () => {
  await prisma.generatedSegment.deleteMany({ where: { generationTaskId: { in: taskIds } } })
  await prisma.generationTask.deleteMany({ where: { id: { in: taskIds } } })
  await prisma.copyFramework.deleteMany({ where: { id: { in: frameworkIds } } })
})

// 快闪模板 + 可调预算：预算用于第 3 条「标记必须在预算校验前剥离」的鉴别性构造。
async function makeFramework(maxTotalChars = 200) {
  const fw = await prisma.copyFramework.create({
    data: {
      frameworkText: '开头钩子+逐段展开，语气亲切',
      overlayTemplate: { __templateParams: { mode: 'flash', open: { titleText: '今天分享的是' } } } as never,
      suggestedSegmentCount: 6,
      maxLines: 10,
      maxTotalChars,
    },
  })
  frameworkIds.push(fw.id)
  return fw
}

const BOOKS = [{ title: '甲书', author: '甲作者' }, { title: '乙书', author: '乙作者' }, { title: '丙书' }]

async function makeTask(frameworkId: string) {
  const task = await prisma.generationTask.create({
    data: { subject: '走出低谷期', frameworkId, variables: { books: BOOKS } as never },
  })
  taskIds.push(task.id)
  return task
}

async function bookTitles(taskId: string) {
  const segs = await prisma.generatedSegment.findMany({ where: { generationTaskId: taskId }, orderBy: { seqNo: 'asc' } })
  return segs.map((s) => s.bookTitle ?? null)
}

beforeEach(() => {
  mockLlmComplete.mockReset()
  mockIsMockMode.mockReset()
  mockGetCapabilityConfig.mockReset()
  mockEnqueueGen.mockReset()
  mockGetCapabilityConfig.mockResolvedValue({ capability: 'llm', baseUrl: '', apiKey: '', model: '', enabled: false, extra: {} })
  // translateLine 走 mock 短路，保证 mockLlmComplete 的调用只来自文案生成本身
  mockIsMockMode.mockReturnValue(true)
})

describe('generateScript：《书名》头跟随书序号标记', () => {
  it('LLM 返回带标记 → 书名头按标记分配，而非位置均分', async () => {
    const fw = await makeFramework()
    const task = await makeTask(fw.id)
    // 标记分配 → [null,甲,甲,甲,乙,丙]
    // 位置均分 allocateBookIndexes(6,3)=[0,0,1,1,2,2] → [甲,甲,乙,乙,丙,丙]
    // 两者在 4 个位置上不同，测试有鉴别力
    mockLlmComplete.mockResolvedValue('0|今天分享的是三本书\n1|甲书一句\n1|甲书二句\n1|甲书三句\n2|乙书一句\n3|丙书一句')

    await generateScript(task.id)

    expect(await bookTitles(task.id)).toEqual([null, '甲书', '甲书', '甲书', '乙书', '丙书'])
  })

  it('落库文案不带书序号前缀', async () => {
    const fw = await makeFramework()
    const task = await makeTask(fw.id)
    mockLlmComplete.mockResolvedValue('0|今天分享的是三本书\n1|甲书一句\n2|乙书一句')

    await generateScript(task.id)

    const segs = await prisma.generatedSegment.findMany({ where: { generationTaskId: task.id }, orderBy: { seqNo: 'asc' } })
    expect(segs.map((s) => s.scriptText)).toEqual(['今天分享的是三本书', '甲书一句', '乙书一句'])
  })

  it('LLM 不按格式返回 → 回退位置均分，任务不失败', async () => {
    const fw = await makeFramework()
    const task = await makeTask(fw.id)
    mockLlmComplete.mockResolvedValue('甲书一句\n乙书一句\n丙书一句')

    await generateScript(task.id)

    // allocateBookIndexes(3,3) = [0,1,2]
    expect(await bookTitles(task.id)).toEqual(['甲书', '乙书', '丙书'])
  })

  it('书序号标记在预算校验前被剥离（不挤占字数预算）', async () => {
    // 3 行文案各 10 字 = 30 字；带 '1|' 前缀后 = 36 字。预算设 32：
    // 剥离后 30 ≤ 32 → 一次通过、3 段落库；未剥离则 36 > 32 → 重试 3 次后裁剪，只剩 2 段。
    const fw = await makeFramework(32)
    const task = await makeTask(fw.id)
    mockLlmComplete.mockResolvedValue('1|甲甲甲甲甲甲甲甲甲甲\n2|乙乙乙乙乙乙乙乙乙乙\n3|丙丙丙丙丙丙丙丙丙丙')

    await generateScript(task.id)

    expect(mockLlmComplete).toHaveBeenCalledTimes(1) // 未触发超预算重试
    const segs = await prisma.generatedSegment.findMany({ where: { generationTaskId: task.id } })
    expect(segs.length).toBe(3)
  })
})

describe('generateScript：开场白提示词', () => {
  it('flash 模板 → prompt 含模板开场标题与开场白要求', async () => {
    const fw = await makeFramework()
    const task = await makeTask(fw.id)
    mockLlmComplete.mockResolvedValue('0|开场白\n1|甲书一句')

    await generateScript(task.id)

    const prompt = mockLlmComplete.mock.calls[0][0].prompt as string
    expect(prompt).toContain('今天分享的是')
    expect(prompt).toContain('开场白')
    expect(prompt).not.toContain('开篇第一句直击情绪')
  })

  it('classic 模板（第 0 段照常出字幕）→ 不加开场白要求，风格准则维持原文', async () => {
    const fw = await prisma.copyFramework.create({
      data: {
        frameworkText: '开头钩子+逐段展开，语气亲切',
        overlayTemplate: { __templateParams: { mode: 'classic' } } as never,
        suggestedSegmentCount: 6, maxLines: 10, maxTotalChars: 200,
      },
    })
    frameworkIds.push(fw.id)
    const task = await makeTask(fw.id)
    mockLlmComplete.mockResolvedValue('1|甲书一句\n2|乙书一句')

    await generateScript(task.id)

    const prompt = mockLlmComplete.mock.calls[0][0].prompt as string
    expect(prompt).toContain('开篇第一句直击情绪')
    expect(prompt).not.toContain('开场白')
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `DATABASE_URL="postgresql://mixcut:mixcut@127.0.0.1:55433/mixcut_test?schema=public" npx vitest run worker/src/gen/generateScript.align.test.ts`
Expected: FAIL —— 第 1 条得到均分结果；第 3 条落库段数少于 LLM 行数（被预算裁掉）

- [ ] **Step 3: 实现**

在 `worker/src/gen/generateScript.ts` 顶部 import 中，从 `@mixcut/db` 追加 `parseTemplateParams`。

在 `generateScript` 里 `const scriptMode = readScriptMode(...)` 之后插入：

```ts
  // 仅 flash 模板会把第 0 段整段吃进开场快闪且不出字幕（indexHtml 正片字幕取 segs.slice(1)），
  // 只有这种模板需要一句与开场标题呼应的旁白；classic 模板第 0 段照常出字幕，不加开场白。
  const tp = parseTemplateParams((fw.overlayTemplate as { __templateParams?: unknown } | null)?.__templateParams)
  const openTitleText = tp.mode === 'flash' ? tp.open.titleText : undefined
```

把 `buildScriptPrompt({...})` 调用补上 `openTitleText`（imitate 分支不动）。

把 auto/imitate 的重试循环改为：

```ts
    let prompt = basePrompt
    let lastErrors: string[] = []
    let lastClean: string[] = []
    let lastIdxs: number[] | null = null
    let markedIdxs: number[] | null = null
    const bookCount = mode === 'books' ? (books?.length ?? 0) : 0

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const raw = await llmComplete({ prompt, maxTokens: 1200, temperature: 0.9 })
      const rawLines = raw.split('\n')
      // 标记必须在预算校验之前剥离：validateScript/trimToBudget 按字符数算预算，
      // 带着「1|」前缀会让每行凭空多 2 个字符，挤压真实文案预算并令重试循环误判超限。
      const marked = bookCount > 0 && scriptMode === 'auto' ? parseBookMarkedLines(rawLines, bookCount) : null
      const lines = marked ? marked.map((m) => m.text) : rawLines
      const result = validateScript(lines, maxLines, maxTotalChars)
      lastClean = result.clean
      lastIdxs = marked ? marked.map((m) => m.bookIdx) : null

      if (result.errors.length === 0) {
        clean = result.clean
        markedIdxs = lastIdxs
        break
      }

      lastErrors = result.errors
      prompt = `${basePrompt}\n\n上一次生成过长（${result.errors.join('；')}），请压缩到 ${maxLines} 行 / ${maxTotalChars} 字以内重写。`
    }

    if (!clean) {
      if (lastClean.length === 0) {
        await setGenerationStatus(genTaskId, 'FAILED')
        throw new Error(`文案生成为空（已重试 ${MAX_ATTEMPTS} 次）：${lastErrors.join('；')}`)
      }
      clean = trimToBudget(lastClean, maxLines, maxTotalChars)
      // trimToBudget 只从尾部整行丢弃且保持顺序，故按裁剪后长度截取序号即可保持配对；
      // 这依赖 parseBookMarkedLines 已保证每条 text 非空（否则 trimToBudget 的 filter(Boolean) 会错位）。
      markedIdxs = lastIdxs ? lastIdxs.slice(0, clean.length) : null
      console.warn(`[gen] generate-script ${genTaskId}: 超预算兜底裁剪 (${lastErrors.join('；')}) → ${clean.length} 行`)
    }

    if (bookCount > 0 && scriptMode === 'auto' && !markedIdxs) {
      console.warn(`[gen] generate-script ${genTaskId}: 未能解析书序号标记，《书名》头回退位置均分`)
    }
```

注意 `markedIdxs` 须在 `else` 分支外可见（manual 分支不产生序号），故声明位置要提到 `let clean` 旁边：

```ts
  let clean: string[] | null = null
  let markedIdxs: number[] | null = null
```
并把循环内的 `let markedIdxs` 去掉（改为直接赋值），避免遮蔽外层变量。

最后把分配调用改为：

```ts
  const assigned = assignBooksToSegments(clean, booksForAssign(scriptMode, books), markedIdxs ?? undefined)
```

- [ ] **Step 4: 跑测试确认通过**

Run: `DATABASE_URL="postgresql://mixcut:mixcut@127.0.0.1:55433/mixcut_test?schema=public" npx vitest run worker/src/gen/`
Expected: PASS，worker/src/gen 下全部测试绿

- [ ] **Step 5: 提交**

```bash
git add worker/src/gen/generateScript.ts worker/src/gen/generateScript.align.test.ts
git commit -m "feat(script): 书名头改跟书序号标记,标记在预算校验前剥离"
```

---

### Task 5: 终验与文档

**Files:**
- Modify: `docs/superpowers/specs/2026-08-18-script-book-alignment-design.md`（状态改「已实现」，补实现与设计的差异）
- Modify: `docs/2026-08-06-开发交付说明.md`（若其中描述了书名头分配或文案提示词，同步更正）

**Interfaces:**
- Consumes: Task 1-4 全部产出
- Produces: 无

- [ ] **Step 1: 全量测试**

Run: `DATABASE_URL="postgresql://mixcut:mixcut@127.0.0.1:55433/mixcut_test?schema=public" npx vitest run`
Expected: 全绿。**已知偶发**：`web/app/api/admin/students/[id]/route.test.ts > 禁用最后一名可用运营 → 400` 属既有共享测试库串扰（约 1/3 概率），与本批无关；若只有它红，复跑一次确认，并在报告中如实注明，不得据此声称"全绿"。

- [ ] **Step 2: 类型检查与构建**

Run: `npx tsc --noEmit -p worker/tsconfig.json && npm run build -w web`
Expected: 均 exit 0

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

- [ ] **Step 4: 冒烟——真实提示词与解析闭环**

写一次性脚本（放 scratchpad，不入库）：以 5 本书、`openTitleText='今天分享的是'` 调 `buildScriptPrompt`，打印提示词；再用一段**手写的**符合格式的假 LLM 输出（含 `0|` 开场白行）走 `parseBookMarkedLines` → `assignBooksToSegments`，打印每段的 `bookTitle`。
Expected: 开场白段无 `bookTitle`；其余段书名与手写序号逐项一致。**把实际输出贴进报告**，不要只写"符合预期"。

- [ ] **Step 5: 更新文档并提交**

```bash
git add docs/
git commit -m "docs: 文案与画面对齐落地说明"
```
