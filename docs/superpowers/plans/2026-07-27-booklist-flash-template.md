# 「书单快闪版」客户同款模板（P1）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** 新增参数化模板 `booklist-flash`（客户同款）——玻璃碎裂开场 + 书单快闪(AI书封底图+叠书名) + 叠化长镜头 + 莫雪体白字幕 + SFX/BGM 混音，与现有 classic 模板并存、全自动出片。

**Architecture:** 扩展现有 booklist codegen（util/theme/motion/captionsAnim/layout/indexHtml）与 worker 生成链。新增 `templateParams.ts`（参数+时间线）、`flashMontage.ts`（快闪 codegen）、`bookCoverPrompt.ts`（书封提示词）；扩展 `generateImage`（flash 模式补生书封）、`renderVisuals`（组装 flashCovers + BodyData 扩展）、`renderVideo`（SFX 混音）。参数存 `overlayTemplate.__templateParams`，无迁移。

**Tech Stack:** TypeScript + vitest；HyperFrames 0.7.33 无头渲染；ffmpeg 混音；DashScope 文生图。

## Global Constraints

- 引擎/契约不变：`hyperframes@0.7.33 render`；paused GSAP timeline 挂 `window.__timelines["main"]`；**seek-safe**（tween 全字面量，产出 HTML 不含 `function`/`=>`/`Math.random`）；self-contained（本地 gsap + 本地 @font-face，无 `cdn.jsdelivr.net`）；720×960。
- **无数据库迁移**：参数存 `framework.overlayTemplate.__templateParams`；书封存文件。
- **向后兼容**：结构模式唯一来源 `__templateParams.mode`，缺省 `classic`（现有行为不变）；`flash` 才走新结构。classic 全部现有测试必须回归绿。
- **不新增时长/不挪分段起止**：flash 快闪落在**第 0 段的时间窗内**（[0, bodyTimings[0].endMs]），总时长仍 = `max(endMs)`。tween 位置不得越过 `data-duration`。
- **确定性**：招式/时间线由 seqNo/seed/params 纯函数派生；同输入逐字节一致。
- 书封文字**不交给 AI**：AI 只出无字底图（负面词压文字），书名用标题字体叠字层。

## 时间线模型（关键，贯穿全程）

flash 模式下第 0 段 = 开场+快闪的可视化窗口（narration 从 0 连续播放，快闪是它的视觉）：
- `openEndMs` = min(`open.durationMs` 默认 2160, seg0.endMs*0.55)：玻璃碎裂开场 +「今天分享的是」标题。
- 快闪窗口 = `[openEndMs, seg0.endMs]`，N 本书均分：`perClipMs = (seg0.endMs - openEndMs) / N`（受 `flash.perClipMs` 上限/下限兜底）。
- `flashEndMs = seg0.endMs`（= 水滴音效 + 叠化进正片处）。
- 第 1..N 段 = 正片长镜头（叠化 + 莫雪体字幕），时间不变。

---

## File Structure

| 文件 | 动作 | 职责 |
|---|---|---|
| `worker/templates/booklist/templateParams.ts` | 新增 | 参数类型/默认值/解析合并 + `flashTimeline()` |
| `worker/templates/booklist/bookCoverPrompt.ts` | 新增 | 书封底图提示词（纯函数） |
| `worker/templates/booklist/flashMontage.ts` | 新增 | 开场标题 + 书单快闪卡 HTML+tweens |
| `worker/templates/booklist/layout.ts` | 改 | `@font-face` 注入 + 快闪卡 CSS + 参数化字幕 CSS 变量 |
| `worker/templates/booklist/indexHtml.ts` | 改 | flash 分支编排 + BodyData 扩展(template/templateParams/flashCovers) |
| `worker/src/gen/generateImage.ts` | 改 | flash 模式：正片图后补生 N 张书封底图到 `covers/NN.png` |
| `worker/src/gen/renderVisuals.ts` | 改 | 解析 templateParams + 组装 flashCovers + 设 BodyData 新字段 |
| `worker/src/gen/renderVideo.ts` | 改 | SFX 层(齿轮/水滴)混音 + bgmVolume 参数 |
| `worker/assets/sfx/{gear,drop}.mp3` | 新增 | 内置音效（先占位，后换免版权） |
| `worker/templates/booklist/fonts/README.md` | 新增 | 客户字体放置说明（字体文件由客户提供） |

---

## Task 1: 参数与时间线 templateParams.ts

**Files:**
- Create: `worker/templates/booklist/templateParams.ts`
- Test: `worker/templates/booklist/templateParams.test.ts`

**Interfaces (Produces):**
- `type TemplateMode = 'classic' | 'flash'`
- `interface TemplateParams { mode; open:{durationMs;shatter;titleText;sfx}; flash:{perClipMs;minClipMs;bounceIn;titleFontFamily}; transition:{type;durationMs}; body:{subtitleFontFamily;subtitleColor;subtitlePosY;kenBurns}; audio:{bgmVolume;sfx:{openGear;transitionDrop}} }`
- `const DEFAULT_PARAMS: TemplateParams`
- `parseTemplateParams(raw: unknown): TemplateParams` — 深合并到默认；`mode` 非 'flash' 一律归 'classic'
- `interface FlashTimeline { openEndMs; flashEndMs; perClipMs; count }`
- `flashTimeline(p: TemplateParams, seg0EndMs: number, bookCount: number): FlashTimeline`

- [ ] **Step 1: 写失败测试**

```ts
// worker/templates/booklist/templateParams.test.ts
import { describe, it, expect } from 'vitest'
import { DEFAULT_PARAMS, parseTemplateParams, flashTimeline } from './templateParams'

describe('parseTemplateParams', () => {
  it('缺省 → classic + 默认值', () => {
    const p = parseTemplateParams(undefined)
    expect(p.mode).toBe('classic')
    expect(p.audio.bgmVolume).toBe(DEFAULT_PARAMS.audio.bgmVolume)
  })
  it('mode=flash 生效，其余字段深合并默认', () => {
    const p = parseTemplateParams({ mode: 'flash', body: { subtitleColor: '#ff0' } })
    expect(p.mode).toBe('flash')
    expect(p.body.subtitleColor).toBe('#ff0')
    expect(p.body.subtitlePosY).toBe(DEFAULT_PARAMS.body.subtitlePosY) // 未给的仍默认
    expect(p.open.titleText).toBe(DEFAULT_PARAMS.open.titleText)
  })
  it('非法 mode / 非对象 → classic', () => {
    expect(parseTemplateParams({ mode: 'weird' }).mode).toBe('classic')
    expect(parseTemplateParams('x').mode).toBe('classic')
    expect(parseTemplateParams(null).mode).toBe('classic')
  })
})

describe('flashTimeline', () => {
  it('开场取 min(durationMs, seg0*0.55)，快闪均分剩余窗口', () => {
    const p = parseTemplateParams({ mode: 'flash' }) // open.durationMs=2160
    const t = flashTimeline(p, 4000, 9)
    expect(t.openEndMs).toBe(2160) // min(2160, 2200)
    expect(t.flashEndMs).toBe(4000)
    expect(t.count).toBe(9)
    expect(t.perClipMs).toBeCloseTo((4000 - 2160) / 9, 3)
  })
  it('seg0 很短 → 开场按 55% 收缩，perClipMs 不低于 minClipMs', () => {
    const p = parseTemplateParams({ mode: 'flash', flash: { minClipMs: 120 } })
    const t = flashTimeline(p, 2000, 20) // 剩余(2000-1100)/20=45 < 120 → 夹到 120
    expect(t.openEndMs).toBe(1100) // 2000*0.55
    expect(t.perClipMs).toBe(120)
  })
  it('bookCount=0 → perClipMs=0、count=0（不崩）', () => {
    const t = flashTimeline(parseTemplateParams({ mode: 'flash' }), 4000, 0)
    expect(t.count).toBe(0)
    expect(t.perClipMs).toBe(0)
  })
})
```

- [ ] **Step 2: 运行确认失败** — `npx vitest run worker/templates/booklist/templateParams.test.ts` → FAIL(模块不存在)

- [ ] **Step 3: 实现**

```ts
// worker/templates/booklist/templateParams.ts
// booklist 模板参数：结构/节奏/转场/字幕/快闪/音效。默认值=从客户剪映工程解出的配方。
// P2 学习器将产出同结构对象填 framework.overlayTemplate.__templateParams。

export type TemplateMode = 'classic' | 'flash'

export interface TemplateParams {
  mode: TemplateMode
  open: { durationMs: number; shatter: boolean; titleText: string; sfx: boolean }
  flash: { perClipMs: number; minClipMs: number; bounceIn: boolean; titleFontFamily: string }
  transition: { type: 'dissolve'; durationMs: number }
  body: { subtitleFontFamily: string; subtitleColor: string; subtitlePosY: number; kenBurns: 'subtle' | 'off' }
  audio: { bgmVolume: number; sfx: { openGear: boolean; transitionDrop: boolean } }
}

export const DEFAULT_PARAMS: TemplateParams = {
  mode: 'classic',
  open: { durationMs: 2160, shatter: true, titleText: '今天分享的是', sfx: true },
  flash: { perClipMs: 200, minClipMs: 120, bounceIn: true, titleFontFamily: 'flash-title' },
  transition: { type: 'dissolve', durationMs: 400 },
  body: { subtitleFontFamily: 'subtitle', subtitleColor: '#ffffff', subtitlePosY: 0.78, kenBurns: 'subtle' },
  audio: { bgmVolume: 0.69, sfx: { openGear: true, transitionDrop: true } },
}

function obj(x: unknown): Record<string, unknown> {
  return x && typeof x === 'object' && !Array.isArray(x) ? (x as Record<string, unknown>) : {}
}
function num(v: unknown, d: number): number { return typeof v === 'number' && Number.isFinite(v) ? v : d }
function str(v: unknown, d: string): string { return typeof v === 'string' && v.trim() ? v : d }
function bool(v: unknown, d: boolean): boolean { return typeof v === 'boolean' ? v : d }

export function parseTemplateParams(raw: unknown): TemplateParams {
  const r = obj(raw)
  const D = DEFAULT_PARAMS
  const open = obj(r.open), flash = obj(r.flash), tr = obj(r.transition), body = obj(r.body)
  const audio = obj(r.audio), sfx = obj(audio.sfx)
  return {
    mode: r.mode === 'flash' ? 'flash' : 'classic',
    open: {
      durationMs: num(open.durationMs, D.open.durationMs),
      shatter: bool(open.shatter, D.open.shatter),
      titleText: str(open.titleText, D.open.titleText),
      sfx: bool(open.sfx, D.open.sfx),
    },
    flash: {
      perClipMs: num(flash.perClipMs, D.flash.perClipMs),
      minClipMs: num(flash.minClipMs, D.flash.minClipMs),
      bounceIn: bool(flash.bounceIn, D.flash.bounceIn),
      titleFontFamily: str(flash.titleFontFamily, D.flash.titleFontFamily),
    },
    transition: { type: 'dissolve', durationMs: num(tr.durationMs, D.transition.durationMs) },
    body: {
      subtitleFontFamily: str(body.subtitleFontFamily, D.body.subtitleFontFamily),
      subtitleColor: str(body.subtitleColor, D.body.subtitleColor),
      subtitlePosY: num(body.subtitlePosY, D.body.subtitlePosY),
      kenBurns: body.kenBurns === 'off' ? 'off' : 'subtle',
    },
    audio: {
      bgmVolume: num(audio.bgmVolume, D.audio.bgmVolume),
      sfx: { openGear: bool(sfx.openGear, D.audio.sfx.openGear), transitionDrop: bool(sfx.transitionDrop, D.audio.sfx.transitionDrop) },
    },
  }
}

export interface FlashTimeline { openEndMs: number; flashEndMs: number; perClipMs: number; count: number }

// 快闪落在第 0 段时间窗内：开场 [0,openEndMs] + 快闪 [openEndMs,seg0EndMs] 均分 N 本。
export function flashTimeline(p: TemplateParams, seg0EndMs: number, bookCount: number): FlashTimeline {
  const openEndMs = Math.round(Math.min(p.open.durationMs, seg0EndMs * 0.55))
  const count = Math.max(0, bookCount)
  if (count === 0) return { openEndMs, flashEndMs: seg0EndMs, perClipMs: 0, count: 0 }
  const win = Math.max(0, seg0EndMs - openEndMs)
  const perClipMs = Math.max(p.flash.minClipMs, win / count)
  return { openEndMs, flashEndMs: seg0EndMs, perClipMs, count }
}
```

- [ ] **Step 4: 运行确认通过** — PASS
- [ ] **Step 5: 提交** — `git add worker/templates/booklist/templateParams.* && git commit -m "feat(flash): 模板参数 schema + 快闪时间线 templateParams.ts"`

---

## Task 2: 书封提示词 bookCoverPrompt.ts

**Files:**
- Create: `worker/templates/booklist/bookCoverPrompt.ts`
- Test: `worker/templates/booklist/bookCoverPrompt.test.ts`

**Interfaces (Produces):**
- `interface CoverPrompt { prompt: string; negativePrompt: string }`
- `buildBookCoverPrompt(book: { title: string; author?: string }, styleHint?: string): CoverPrompt` — 生成"无字书封底图"提示词；正向绝不含书名文本，负向强力压文字

- [ ] **Step 1: 写失败测试**

```ts
// worker/templates/booklist/bookCoverPrompt.test.ts
import { describe, it, expect } from 'vitest'
import { buildBookCoverPrompt } from './bookCoverPrompt'

describe('buildBookCoverPrompt', () => {
  it('产出封面底图诉求 + 无文字诉求，且正向不含书名文本', () => {
    const { prompt, negativePrompt } = buildBookCoverPrompt({ title: '活着', author: '余华' })
    expect(prompt).toMatch(/book cover|封面/)
    expect(prompt).toContain('no text')
    expect(prompt).not.toContain('活着') // 书名绝不进正向(避免AI画字)
    expect(prompt).not.toContain('余华')
  })
  it('负面词包含压制文字的关键词(中英)', () => {
    const { negativePrompt } = buildBookCoverPrompt({ title: 'X' })
    for (const w of ['text', 'letters', 'title', '文字', '字']) expect(negativePrompt).toContain(w)
  })
  it('styleHint 注入正向', () => {
    expect(buildBookCoverPrompt({ title: 'X' }, '复古摄影').prompt).toContain('复古摄影')
  })
})
```

- [ ] **Step 2: 运行确认失败** — FAIL

- [ ] **Step 3: 实现**

```ts
// worker/templates/booklist/bookCoverPrompt.ts
// 书单快闪的书封「底图」提示词：只出封面质感画面、居中留白给标题区、绝不含任何文字。
// 书名由标题字体叠字层渲染(见 flashMontage)，因此这里刻意不把书名放进正向提示。

export interface CoverPrompt { prompt: string; negativePrompt: string }

const COVER_NEG =
  '文字, 字, 汉字, 字母, 单词, 书法, 标题, 作者名, 字幕, 水印, 条形码, ' +
  'text, letters, words, title, author, typography, caption, watermark, barcode, signature'

export function buildBookCoverPrompt(book: { title: string; author?: string }, styleHint?: string): CoverPrompt {
  const style = (styleHint ?? '文艺极简').trim()
  const prompt = [
    `a ${style} literary book cover background`,
    '文艺书籍封面底图, 优雅抽象构图, 克制的低饱和色调, 中央留出空白标题区',
    'high-quality print texture, elegant, minimalist, 3:4 portrait, no text',
  ].join(', ')
  return { prompt, negativePrompt: COVER_NEG }
}
```

- [ ] **Step 4: 运行确认通过** — PASS
- [ ] **Step 5: 提交** — `git commit -m "feat(flash): 书封底图提示词 bookCoverPrompt.ts"`

---

## Task 3: flash 模式补生书封 generateImage.ts

**Files:**
- Modify: `worker/src/gen/generateImage.ts`
- Test: `worker/src/gen/generateImage.covers.test.ts`

**Interfaces:**
- Consumes: `parseTemplateParams` from `../../templates/booklist/templateParams`；`buildBookCoverPrompt` from `../../templates/booklist/bookCoverPrompt`；`imageGenerate`,`withRetry` from `@mixcut/db`
- Produces:
  - `resolveBooks(overlayTemplate: unknown, variables: unknown): { title: string; author?: string }[]` — 纯函数，取书单(overlayTemplate.books 优先，回退 variables.books)
  - 副作用：flash 模式下正片图生成后，为每本书生成 `covers/NN.png`

- [ ] **Step 1: 写失败测试（纯函数 resolveBooks）**

```ts
// worker/src/gen/generateImage.covers.test.ts
import { describe, it, expect } from 'vitest'
import { resolveBooks } from './generateImage'

describe('resolveBooks', () => {
  it('优先 overlayTemplate.books', () => {
    expect(resolveBooks({ books: [{ title: '活着', author: '余华' }] }, { books: [{ title: 'X' }] }))
      .toEqual([{ title: '活着', author: '余华' }])
  })
  it('overlayTemplate 无 → 回退 variables.books', () => {
    expect(resolveBooks({}, { books: [{ title: 'A' }] })).toEqual([{ title: 'A' }])
  })
  it('过滤无 title 的脏项；都没有 → []', () => {
    expect(resolveBooks({ books: [{ title: '' }, { author: 'x' }, { title: 'B' }] }, {})).toEqual([{ title: 'B' }])
    expect(resolveBooks({}, {})).toEqual([])
  })
})
```

- [ ] **Step 2: 运行确认失败** — FAIL

- [ ] **Step 3: 实现（在 generateImage.ts 追加 resolveBooks 导出 + flash 分支）**

在文件顶部 import 追加：
```ts
import { parseTemplateParams } from '../../templates/booklist/templateParams'
import { buildBookCoverPrompt } from '../../templates/booklist/bookCoverPrompt'
```

追加纯函数导出：
```ts
// 取书单：overlayTemplate.books 优先，回退 variables.books；过滤无 title 的脏项。
export function resolveBooks(overlayTemplate: unknown, variables: unknown): { title: string; author?: string }[] {
  const pick = (x: unknown): { title: string; author?: string }[] => {
    const arr = (x && typeof x === 'object' && Array.isArray((x as { books?: unknown }).books))
      ? ((x as { books: unknown[] }).books) : []
    return arr
      .filter((b) => b && typeof (b as { title?: unknown }).title === 'string' && (b as { title: string }).title.trim())
      .map((b) => {
        const o = b as { title: string; author?: unknown }
        return { title: o.title.trim(), ...(typeof o.author === 'string' && o.author.trim() ? { author: o.author.trim() } : {}) }
      })
  }
  const fromOverlay = pick(overlayTemplate)
  return fromOverlay.length ? fromOverlay : pick(variables)
}
```

在 `generateImage` 末尾（写完正片图、`setGenerationStatus` **之前**）追加 flash 分支：
```ts
  // flash 模式：为书单每本书补生一张「书封底图」(无字)，供快闪叠书名用。
  const params = parseTemplateParams((task.framework.overlayTemplate as { __templateParams?: unknown } | null)?.__templateParams)
  if (params.mode === 'flash') {
    const books = resolveBooks(task.framework.overlayTemplate, task.variables)
    const coversDir = path.join(dir, 'covers')
    await fs.mkdir(coversDir, { recursive: true })
    const styleHint = task.framework.imageStylePrompt ?? undefined
    for (const [i, book] of books.entries()) {
      const { prompt, negativePrompt } = buildBookCoverPrompt(book, styleHint)
      const png = await withRetry(() => imageGenerate({ prompt, size: '720x960', negativePrompt }), {
        attempts: 3, delayMs: 3000,
        onRetry: (err, n) => console.warn(`[gen] book-cover ${genTaskId} #${i} 第${n}次失败,重试: ${(err as Error).message?.slice(0, 90)}`),
      })
      await fs.writeFile(path.join(coversDir, `${String(i + 1).padStart(2, '0')}.png`), png)
    }
    console.log(`[gen] generate-image ${genTaskId}: flash 书封 ${books.length} 张`)
  }
```

- [ ] **Step 4: 运行确认通过** — `npx vitest run worker/src/gen/generateImage.covers.test.ts` → PASS；`npx tsc --noEmit -p worker/tsconfig.json` → exit 0
- [ ] **Step 5: 提交** — `git commit -m "feat(flash): generate-image 补生书封底图 + resolveBooks"`

---

## Task 4: 快闪 codegen flashMontage.ts

**Files:**
- Create: `worker/templates/booklist/flashMontage.ts`
- Test: `worker/templates/booklist/flashMontage.test.ts`

**Interfaces:**
- Consumes: `esc`,`sec` from `./util`；`FlashTimeline` from `./templateParams`
- Produces:
  - `interface FlashCover { title: string; author?: string; coverSrc: string }`
  - `openTitleHtml(titleText: string): string` — `.flash-open` 标题元素(碎裂开场上层的「今天分享的是」)
  - `openTitleTweens(openEndMs: number): string` — 0s 淡入、openEndMs 前淡出
  - `flashCardsHtml(covers: FlashCover[], titleFontFamily: string): string` — 每本一个 `.flashcard.fcN`(封面底图 + 叠书名)
  - `flashCardsTweens(covers: FlashCover[], t: FlashTimeline, bounceIn: boolean): string` — 第 k 本在 `openEndMs+k*perClipMs` 处快速切入、下一本切入时收起；全字面量 seek-safe

- [ ] **Step 1: 写失败测试**

```ts
// worker/templates/booklist/flashMontage.test.ts
import { describe, it, expect } from 'vitest'
import { openTitleHtml, openTitleTweens, flashCardsHtml, flashCardsTweens } from './flashMontage'

const covers = [
  { title: '活着', author: '余华', coverSrc: 'covers/01.png' },
  { title: '兄弟', coverSrc: 'covers/02.png' },
]
const tl = { openEndMs: 2000, flashEndMs: 4000, perClipMs: 1000, count: 2 }

describe('openTitle', () => {
  it('标题元素含文本、data-layout-ignore、转义', () => {
    expect(openTitleHtml('今天<x>')).toContain('class="flash-open" data-layout-ignore')
    expect(openTitleHtml('今天<x>')).toContain('今天&lt;x&gt;')
  })
  it('0s 淡入、openEndMs 前收起', () => {
    const t = openTitleTweens(2000)
    expect(t).toContain(', 0)')
    expect(t).not.toContain('function')
  })
})

describe('flashCards', () => {
  it('每本一卡：封面底图 + 叠书名(标题字体类)', () => {
    const h = flashCardsHtml(covers, 'flash-title')
    expect((h.match(/class="flashcard/g) ?? []).length).toBe(2)
    expect(h).toContain("covers/01.png")
    expect(h).toContain('活着')
    expect(h).toContain('flash-title') // 标题字体族类名
  })
  it('每卡在 openEndMs+k*perClipMs 处切入，位置字面量、不含 function', () => {
    const t = flashCardsTweens(covers, tl, true)
    expect(t).toContain(', 2)')  // 第0本 @ 2.0s
    expect(t).toContain(', 3)')  // 第1本 @ 3.0s
    expect(t).not.toContain('function')
    expect(t).not.toContain('=>')
  })
})
```

- [ ] **Step 2: 运行确认失败** — FAIL

- [ ] **Step 3: 实现**

```ts
// worker/templates/booklist/flashMontage.ts
// 书单快闪：开场「今天分享的是」标题 + 逐本书封面(底图+叠书名)极速闪过。全字面量 seek-safe。
import { esc, sec } from './util'
import type { FlashTimeline } from './templateParams'

export interface FlashCover { title: string; author?: string; coverSrc: string }

export function openTitleHtml(titleText: string): string {
  return `    <div class="flash-open" data-layout-ignore>\n      <div class="fo-kicker"></div>\n      <div class="fo-title">${esc(titleText)}</div>\n    </div>`
}

export function openTitleTweens(openEndMs: number): string {
  const end = sec(openEndMs)
  const out = Math.max(0, Math.round((openEndMs - 300) / 1000 * 1000) / 1000)
  return [
    `  tl.fromTo('.flash-open', { opacity: 0, y: 20 }, { opacity: 1, y: 0, duration: 0.4, ease: 'power2.out' }, 0);`,
    `  tl.to('.flash-open', { opacity: 0, duration: 0.25, ease: 'sine.in' }, ${out});`,
    `  tl.set('.flash-open', { opacity: 0 }, ${end});`,
  ].join('\n')
}

export function flashCardsHtml(covers: FlashCover[], titleFontFamily: string): string {
  return covers
    .map((c, i) => {
      const n = i + 1
      const author = c.author && c.author.trim() ? `\n        <div class="fc-author">${esc(c.author)}</div>` : ''
      return (
        `    <div class="flashcard fc${n}" data-layout-ignore>\n` +
        `      <div class="fc-cover" style="background-image:url('${esc(c.coverSrc)}')"></div>\n` +
        `      <div class="fc-title" style="font-family:'${esc(titleFontFamily)}'">《${esc(c.title)}》</div>${author}\n` +
        `    </div>`
      )
    })
    .join('\n')
}

export function flashCardsTweens(covers: FlashCover[], t: FlashTimeline, bounceIn: boolean): string {
  const lines: string[] = []
  covers.forEach((_c, i) => {
    const n = i + 1
    const at = sec(t.openEndMs + i * t.perClipMs)
    const off = sec(t.openEndMs + (i + 1) * t.perClipMs)
    const from = bounceIn ? `{ opacity: 0, scale: 0.86 }` : `{ opacity: 0 }`
    const to = bounceIn ? `opacity: 1, scale: 1` : `opacity: 1`
    lines.push(`  tl.fromTo('.fc${n}', ${from}, { ${to}, duration: 0.12, ease: 'back.out(2)' }, ${at});`)
    lines.push(`  tl.set('.fc${n}', { opacity: 0 }, ${off});`)
  })
  return lines.join('\n')
}
```

- [ ] **Step 4: 运行确认通过** — PASS
- [ ] **Step 5: 提交** — `git commit -m "feat(flash): 快闪 codegen(开场标题+书封卡) flashMontage.ts"`

---

## Task 5: layout 扩展（@font-face + 快闪 CSS + 参数化字幕）

**Files:**
- Modify: `worker/templates/booklist/layout.ts`
- Test: `worker/templates/booklist/layout.flash.test.ts`

**Interfaces (Produces, 追加):**
- `fontFaceCss(fonts: { family: string; url: string }[]): string` — `@font-face` 块（本地相对路径，self-contained）
- `flashCss(): string` — `.flash-open`/`.fo-title`/`.fo-kicker`/`.flashcard`/`.fc-cover`/`.fc-title`/`.fc-author` 结构 CSS
- `subtitleVarsCss(body: { subtitleColor: string; subtitlePosY: number; subtitleFontFamily: string }): string` — 覆盖字幕相关 CSS 变量 `--ink`(字幕色)/`--cap-bottom`/字幕字体族

- [ ] **Step 1: 写失败测试**

```ts
// worker/templates/booklist/layout.flash.test.ts
import { describe, it, expect } from 'vitest'
import { fontFaceCss, flashCss, subtitleVarsCss } from './layout'

describe('fontFaceCss', () => {
  it('生成 @font-face，本地路径，无外网', () => {
    const css = fontFaceCss([{ family: 'flash-title', url: 'fonts/title.ttf' }])
    expect(css).toContain('@font-face')
    expect(css).toContain("font-family: 'flash-title'")
    expect(css).toContain("url('fonts/title.ttf')")
    expect(css).not.toContain('http')
  })
  it('空数组 → 空串', () => { expect(fontFaceCss([])).toBe('') })
})

describe('flashCss', () => {
  it('含快闪卡与开场标题结构类', () => {
    const c = flashCss()
    for (const k of ['.flash-open', '.fo-title', '.flashcard', '.fc-cover', '.fc-title']) expect(c).toContain(k)
  })
})

describe('subtitleVarsCss', () => {
  it('把字幕色/位置/字体写成 CSS 变量', () => {
    const c = subtitleVarsCss({ subtitleColor: '#ffffff', subtitlePosY: 0.78, subtitleFontFamily: 'subtitle' })
    expect(c).toContain('#ffffff')
    expect(c).toContain('subtitle')
  })
})
```

- [ ] **Step 2: 运行确认失败** — FAIL

- [ ] **Step 3: 实现（追加到 layout.ts 末尾）**

```ts
// —— 追加到 worker/templates/booklist/layout.ts ——

// 本地 @font-face（self-contained：字体文件随 hf 项目拷贝，相对路径引用；缺文件时浏览器回退系统字体）
export function fontFaceCss(fonts: { family: string; url: string }[]): string {
  if (!fonts.length) return ''
  return fonts
    .map((f) => `    @font-face { font-family: '${f.family}'; src: url('${f.url}'); font-display: swap; }`)
    .join('\n')
}

// 快闪结构 CSS（开场标题 + 书封卡：满屏封面底图 + 居中大书名）
export function flashCss(): string {
  return `    .flash-open { position:absolute; top:44%; left:0; right:0; text-align:center; z-index:22; opacity:0; padding:0 40px; text-shadow:0 2px 14px rgba(0,0,0,.7); }
    .flash-open .fo-kicker { display:inline-block; width:54px; height:4px; background:var(--accent); border-radius:2px; margin-bottom:16px; }
    .flash-open .fo-title { color:var(--ink); font-size:56px; font-weight:800; font-family:var(--font-title); line-height:1.2; }
    .flashcard { position:absolute; inset:0; z-index:18; opacity:0; overflow:hidden; }
    .flashcard .fc-cover { position:absolute; inset:0; background-size:cover; background-position:center; }
    .flashcard .fc-title { position:absolute; left:40px; right:40px; top:50%; transform:translateY(-50%); text-align:center; color:#fff; font-size:60px; font-weight:800; line-height:1.15; text-shadow:0 3px 18px rgba(0,0,0,.85); }
    .flashcard .fc-author { position:absolute; left:0; right:0; top:62%; text-align:center; color:var(--accent); font-size:28px; font-weight:600; text-shadow:0 2px 10px rgba(0,0,0,.8); }`
}

// 用参数覆盖字幕相关 CSS 变量（注入到 :root 之后，优先级更高的第二个 :root）
export function subtitleVarsCss(body: { subtitleColor: string; subtitlePosY: number; subtitleFontFamily: string }): string {
  // subtitlePosY: 0..1 归一化(0.78≈下三分) → bottom = (1 - posY) * 960
  const bottom = Math.round((1 - body.subtitlePosY) * 960)
  return `    :root { --cap-color: ${body.subtitleColor}; --cap-bottom: ${bottom}px; --cap-font: '${body.subtitleFontFamily}', var(--font-body); }`
}
```

> 说明：`baseCss` 的 `.cap-zh` 需改用 `var(--cap-color, var(--ink))`、`.cap` 用 `bottom: var(--cap-bottom, 150px)`、`.cap-zh` 加 `font-family: var(--cap-font, inherit)`。在本任务同时修改 `baseCss` 这三处（不影响 classic：变量未定义时回退原值）。对应补一条断言：
```ts
it('baseCss 字幕改用可覆盖变量(带回退)', () => {
  const { baseCss } = require('./layout')
  const css = baseCss('warm-literary')
  expect(css).toContain('var(--cap-color')
  expect(css).toContain('var(--cap-bottom')
})
```

- [ ] **Step 4: 运行确认通过** — PASS（含 layout.test.ts 原有回归）
- [ ] **Step 5: 提交** — `git commit -m "feat(flash): layout 加 @font-face/快闪CSS/参数化字幕变量"`

---

## Task 6: indexHtml flash 分支 + BodyData 扩展

**Files:**
- Modify: `worker/templates/booklist/indexHtml.ts`
- Test: `worker/templates/booklist/indexHtml.flash.test.ts`

**Interfaces:**
- Consumes: 全部上述模块
- Produces:
  - `BodyData` 追加：`template?: 'classic' | 'flash'`；`templateParams?: import('./templateParams').TemplateParams`；`flashCovers?: import('./flashMontage').FlashCover[]`；`fonts?: { family: string; url: string }[]`
  - `renderIndexHtml` 分支：`data.template==='flash'` → flash 编排，否则 classic（默认不变）

- [ ] **Step 1: 写失败测试**

```ts
// worker/templates/booklist/indexHtml.flash.test.ts
import { describe, it, expect } from 'vitest'
import { renderIndexHtml, type BodyData } from './indexHtml'
import { parseTemplateParams } from './templateParams'

const flashData: BodyData = {
  size: { width: 720, height: 960 },
  overlay: { title: '', subtitle: '', watermark: '@读书号' },
  images: [{ src: 'media/01.png' }, { src: 'media/02.png' }],
  seed: 's1',
  template: 'flash',
  templateParams: parseTemplateParams({ mode: 'flash' }),
  flashCovers: [
    { title: '活着', author: '余华', coverSrc: 'covers/01.png' },
    { title: '兄弟', coverSrc: 'covers/02.png' },
  ],
  fonts: [{ family: 'flash-title', url: 'fonts/title.ttf' }, { family: 'subtitle', url: 'fonts/sub.otf' }],
  segments: [
    { seqNo: 1, startMs: 0, endMs: 4000, subtitle: '今天分享的是', imageIndex: 0 },
    { seqNo: 2, startMs: 4000, endMs: 9000, subtitle: '如果你总困在过往', imageIndex: 1,
      captionBeats: [{ zh: '如果你总困在过往', startMs: 4000, endMs: 9000 }] },
  ],
}

describe('renderIndexHtml — flash 分支', () => {
  const html = renderIndexHtml(flashData)
  it('契约仍在、seek-safe、总时长=末段', () => {
    expect(html).toContain('data-composition-id="main"')
    expect(html).toContain('data-duration="9"')
    expect(html).toContain('window.__timelines["main"] = tl;')
    expect(html).not.toContain('function'); expect(html).not.toContain('=>'); expect(html).not.toContain('Math.random')
    expect(html).not.toContain('cdn.jsdelivr.net')
  })
  it('含开场标题 + 书封快闪卡 + @font-face', () => {
    expect(html).toContain('class="flash-open"')
    expect(html).toContain('今天分享的是')
    expect((html.match(/class="flashcard/g) ?? []).length).toBe(2)
    expect(html).toContain('活着')
    expect(html).toContain('@font-face')
    expect(html).toContain("url('fonts/title.ttf')")
  })
  it('正片段(seg2)仍出场景+字幕', () => {
    expect(html).toContain('如果你总困在过往')
  })
  it('确定性', () => { expect(renderIndexHtml(flashData)).toBe(renderIndexHtml(flashData)) })
})

describe('renderIndexHtml — classic 回归', () => {
  it('无 template 字段 → 走 classic，不含快闪', () => {
    const classic: BodyData = { ...flashData, template: undefined, templateParams: undefined, flashCovers: undefined }
    const html = renderIndexHtml(classic)
    expect(html).not.toContain('class="flash-open"')
    expect(html).not.toContain('class="flashcard')
    expect(html).toContain('data-composition-id="main"')
  })
})
```

- [ ] **Step 2: 运行确认失败** — FAIL

- [ ] **Step 3: 实现**

BodyData 接口追加字段（在 `indexHtml.ts` 的 `interface BodyData` 内）：
```ts
  template?: 'classic' | 'flash'
  templateParams?: import('./templateParams').TemplateParams
  flashCovers?: import('./flashMontage').FlashCover[]
  fonts?: { family: string; url: string }[]
```

顶部 import 追加：
```ts
import { flashTimeline } from './templateParams.js'
import { openTitleHtml, openTitleTweens, flashCardsHtml, flashCardsTweens } from './flashMontage.js'
import { fontFaceCss, flashCss, subtitleVarsCss } from './layout.js'
```

在 `renderIndexHtml` 开头，选好 preset/offset 之后，加分支派发：
```ts
  if (data.template === 'flash' && data.templateParams) return renderFlash(data, preset, offset)
```

新增 `renderFlash`（复用 classic 的正片/字幕/书名头逻辑，仅第 0 段替换为开场+快闪；转场固定叠化）：
```ts
function renderFlash(data: BodyData, preset: import('./theme').PresetId, offset: number): string {
  const { width, height } = data.size
  const segs = [...data.segments].sort((a, b) => a.startMs - b.startMs)
  const lastEndSec = sec(Math.max(...segs.map((s) => s.endMs)))
  const p = data.templateParams!
  const covers = data.flashCovers ?? []
  const t = flashTimeline(p, segs[0].endMs, covers.length)
  const imgFor = (s: BodySegment, i: number) => data.images[s.imageIndex]?.src ?? data.images[i]?.src ?? ''

  // 场景：第0段=首图(碎裂开场底)；第1..N段=正片
  const scenesHtml = segs.map((s, i) => sceneHtml(i + 1, imgFor(s, i))).join('\n')
  const openingShatterHtml = p.open.shatter
    ? shardGrid({ containerClass: 'shatter s1shatter', imgSrc: imgFor(segs[0], 0), cols: 4, rows: 5, width, height, startScattered: true })
    : ''

  // 运镜/转场：第0段特殊(开场碎裂,不推)；第1..段 轻推(或off) + 固定叠化
  const motionLines: string[] = []
  segs.forEach((s, i) => {
    const n = i + 1
    if (i === 0) {
      motionLines.push(`  tl.set('.s1', { opacity: 1 }, 0);`)
      if (p.open.shatter) motionLines.push(shardOpeningTweens())
    } else {
      if (p.body.kenBurns === 'subtle') motionLines.push(moveTweens('push-in', n, s.startMs, s.endMs, i === segs.length - 1))
      // 固定叠化转场
      motionLines.push(transTweens('crossfade', n, s.startMs))
    }
  })

  // 开场标题 + 快闪卡（落在第0段窗口内）
  const openHtml = openTitleHtml(p.open.titleText)
  const cardsHtml = flashCardsHtml(covers, p.flash.titleFontFamily)
  const flashTweens = [openTitleTweens(t.openEndMs), flashCardsTweens(covers, t, p.flash.bounceIn)].join('\n')

  // 正片字幕：仅第1..N段（第0段视觉是快闪，不出底部字幕）
  const capHtmlParts: string[] = []
  const capTweenParts: string[] = []
  let capIdx = 0
  segs.slice(1).forEach((s) => {
    const beats = Array.isArray(s.captionBeats) && s.captionBeats.length
      ? s.captionBeats : [{ zh: s.subtitle, en: s.subtitleEn, startMs: s.startMs, endMs: s.endMs }]
    for (const b of beats) {
      capIdx++
      const unit = captionUnit({ n: capIdx, entrance: pickEntrance(capIdx - 1, offset), zh: b.zh, en: (b as { en?: string }).en, startMs: b.startMs, endMs: b.endMs })
      capHtmlParts.push(unit.html); capTweenParts.push(unit.tweens)
    }
  })

  const scrim = `    <div class="scrim" data-layout-ignore></div>`
  const decor = overlayDecorHtml(preset)
  const watermark = watermarkHtml(data.overlay.watermark)
  const fontsCss = fontFaceCss(data.fonts ?? [])
  const allTweens = [motionLines.join('\n'), flashTweens, capTweenParts.join('\n')].filter(Boolean).join('\n')

  return `<!doctype html>
<html lang="zh"><head><meta charset="utf-8" />
<meta name="viewport" content="width=${width}, height=${height}" />
<title>booklist flash</title>
<style>
${rootVarsCss(preset)}
${subtitleVarsCss(p.body)}
${fontsCss}
${baseCss(preset)}
${flashCss()}
</style></head>
<body>
<main id="root" data-composition-id="main" data-start="0" data-duration="${lastEndSec}" data-width="${width}" data-height="${height}">
${scenesHtml}
${openingShatterHtml}
${scrim}
${decor}
${openHtml}
${cardsHtml}
${capHtmlParts.join('\n')}
${watermark}
</main>
<script src="gsap.min.js"></script>
<script>
  window.__timelines = window.__timelines || {};
  var tl = gsap.timeline({ paused: true });
${allTweens}
  window.__timelines["main"] = tl;
</script>
</body></html>
`
}
```

> `.cap-zh` 使用 `var(--cap-font)`（Task 5 已改 baseCss）。第0段无底部字幕（快闪即视觉）。

- [ ] **Step 4: 运行确认通过** — flash + classic 回归全绿；`tsc` exit 0
- [ ] **Step 5: 提交** — `git commit -m "feat(flash): indexHtml flash 分支编排 + BodyData 扩展(template/params/covers/fonts)"`

---

## Task 7: renderVisuals 组装 flash 数据

**Files:**
- Modify: `worker/src/gen/renderVisuals.ts`
- Test: `worker/src/gen/renderVisuals.flash.test.ts`

**Interfaces:**
- Consumes: `parseTemplateParams` from `../../templates/booklist/templateParams`；`resolveBooks` from `./generateImage`
- Produces（`buildBodyData` 扩展）：flash 模式下在返回的 `data` 上设 `template='flash'`、`templateParams`、`flashCovers`（title/author 来自 books，coverSrc=`covers/NN.png`，并把 cover 文件加入待拷贝 images 清单）、`fonts`（`flash-title→fonts/title.ttf`、`subtitle→fonts/sub.otf`）。

- [ ] **Step 1: 写失败测试（纯 buildBodyData，不连库）**

```ts
// worker/src/gen/renderVisuals.flash.test.ts
import { describe, it, expect } from 'vitest'
import { buildBodyData } from './renderVisuals'

const base = {
  variables: {},
  bodyTimings: [{ seqNo: 1, startMs: 0, endMs: 4000 }, { seqNo: 2, startMs: 4000, endMs: 9000 }],
}
const segs = [
  { seqNo: 1, scriptText: '今天分享的是', imageUrl: '/api/files/gen/x/1.png' },
  { seqNo: 2, scriptText: '如果你总困在过往', imageUrl: '/api/files/gen/x/2.png' },
]

describe('buildBodyData — flash', () => {
  it('flash 模式设 template/params/flashCovers/fonts', () => {
    const task = { ...base, framework: { overlayTemplate: { __templateParams: { mode: 'flash' }, books: [{ title: '活着', author: '余华' }, { title: '兄弟' }] } } }
    const { data } = buildBodyData(task as any, segs as any, 'gt1')
    expect(data.template).toBe('flash')
    expect(data.templateParams?.mode).toBe('flash')
    expect(data.flashCovers?.map((c: any) => c.title)).toEqual(['活着', '兄弟'])
    expect(data.flashCovers?.[0].coverSrc).toBe('covers/01.png')
    expect(data.fonts?.some((f: any) => f.family === 'flash-title')).toBe(true)
  })
  it('classic(缺省) 不设 flash 字段', () => {
    const task = { ...base, framework: { overlayTemplate: { title: '《x》' } } }
    const { data } = buildBodyData(task as any, segs as any, 'gt2')
    expect(data.template ?? 'classic').toBe('classic')
    expect(data.flashCovers).toBeUndefined()
  })
})
```

- [ ] **Step 2: 运行确认失败** — FAIL

- [ ] **Step 3: 实现**（`renderVisuals.ts`）

顶部 import 追加：
```ts
import { parseTemplateParams } from '../../templates/booklist/templateParams'
import { resolveBooks } from './generateImage'
```
`TaskWithFramework` 的 `framework` 类型补 `imageStylePrompt?: unknown`（已存在字段则忽略）。

在 `buildBodyData` 组装 `data` 处（现有 style/seed 之后），追加 flash 分支：
```ts
  const params = parseTemplateParams((task.framework.overlayTemplate as { __templateParams?: unknown } | null)?.__templateParams)
  if (params.mode === 'flash') {
    const books = resolveBooks(task.framework.overlayTemplate, task.variables)
    const flashCovers = books.map((b, i) => ({
      title: b.title, ...(b.author ? { author: b.author } : {}),
      coverSrc: `covers/${String(i + 1).padStart(2, '0')}.png`,
    }))
    // 书封文件加入待拷贝清单（渲染前 renderVisuals 会把 images[].abs→hf/rel）
    books.forEach((_b, i) => {
      const nn = String(i + 1).padStart(2, '0')
      images.push({ seqNo: 1000 + i, abs: path.join(DATA_DIR, 'gen', genTaskId, 'covers', `${nn}.png`), rel: `covers/${nn}.png` })
    })
    ;(data as BodyData).template = 'flash'
    ;(data as BodyData).templateParams = params
    ;(data as BodyData).flashCovers = flashCovers
    ;(data as BodyData).fonts = [
      { family: 'flash-title', url: 'fonts/title.ttf' },
      { family: 'subtitle', url: 'fonts/sub.otf' },
    ]
  }
  return { data, images }
```

> `renderVisuals()` 主流程已有"拷贝 images[].abs → hfDir/rel"的循环——书封 rel=`covers/NN.png` 会自动随之拷进 hf 项目，无需额外代码。另需在拷贝前 `fs.mkdir(path.join(hfDir,'covers'),{recursive:true})`（在 mediaDir 创建旁边加一行）。字体：把 `worker/templates/booklist/fonts/` 拷到 `hfDir/fonts/`（在拷贝 gsap 处加一次目录拷贝；缺文件不报错）。

- [ ] **Step 4: 运行确认通过** — flash 纯测 + 既有 buildBodyData 测试全绿；`tsc` exit 0
- [ ] **Step 5: 提交** — `git commit -m "feat(flash): renderVisuals 组装 flashCovers/params/fonts + 拷书封与字体"`

---

## Task 8: renderVideo SFX 音效层

**Files:**
- Modify: `worker/src/gen/renderVideo.ts`
- Test: `worker/src/gen/renderVideo.sfx.test.ts`

**Interfaces:**
- Produces（`buildFfmpegArgs` 扩展 opts）：新增可选 `sfx?: { gearAbs?: string; dropAbs?: string; openEndSec: number; dropAtSec: number }` 与 `bgmVolume?: number`。有 SFX 时把齿轮（0 起、限长 openEndSec）与水滴（`adelay dropAtSec`）加入 `amix`；无则行为不变。

- [ ] **Step 1: 写失败测试（纯 buildFfmpegArgs）**

```ts
// worker/src/gen/renderVideo.sfx.test.ts
import { describe, it, expect } from 'vitest'
import { buildFfmpegArgs } from './renderVideo'

const base = { bodyAbs: 'b.mp4', audioAbs: 'a.wav', durSec: 24.6, outAbs: 'o.mp4' }

describe('buildFfmpegArgs — SFX', () => {
  it('无 sfx/bgm → 只人声(原行为)', () => {
    const a = buildFfmpegArgs({ ...base, bgmAbs: null }).join(' ')
    expect(a).toContain('loudnorm'); expect(a).not.toContain('adelay')
  })
  it('带 bgm + sfx → 齿轮/水滴进 amix，bgmVolume 生效', () => {
    const a = buildFfmpegArgs({ ...base, bgmAbs: 'bgm.mp3', bgmVolume: 0.69,
      sfx: { gearAbs: 'gear.mp3', dropAbs: 'drop.mp3', openEndSec: 2.16, dropAtSec: 3.98 } }).join(' ')
    expect(a).toContain('gear.mp3'); expect(a).toContain('drop.mp3')
    expect(a).toContain('adelay=3980|3980')       // 水滴延迟到 3.98s
    expect(a).toContain('volume=0.69')            // bgm 音量参数化
    expect(a).toMatch(/amix=inputs=[34]/)         // 人声+bgm+齿轮+水滴
  })
})
```

- [ ] **Step 2: 运行确认失败** — FAIL

- [ ] **Step 3: 实现**（`buildFfmpegArgs`）

opts 增字段；输入侧按需 push `-i gear`、`-i drop`；afilter 动态拼接。关键实现：
```ts
export function buildFfmpegArgs(opts: {
  bodyAbs: string; audioAbs: string; bgmAbs: string | null; durSec: number; outAbs: string
  bgmVolume?: number
  sfx?: { gearAbs?: string; dropAbs?: string; openEndSec: number; dropAtSec: number }
}): string[] {
  const { bodyAbs, audioAbs, bgmAbs, durSec, outAbs, sfx } = opts
  const bgmVol = typeof opts.bgmVolume === 'number' ? opts.bgmVolume : 0.32
  const args = ['-y', '-i', bodyAbs, '-i', audioAbs]
  let idx = 2
  let bgmIdx = -1, gearIdx = -1, dropIdx = -1
  if (bgmAbs) { args.push('-stream_loop', '-1', '-i', bgmAbs); bgmIdx = idx++ }
  if (sfx?.gearAbs) { args.push('-i', sfx.gearAbs); gearIdx = idx++ }
  if (sfx?.dropAbs) { args.push('-i', sfx.dropAbs); dropIdx = idx++ }

  const vfilter = "[0:v]zoompan=z='if(lte(on,33),1.12-0.12*on/33,1)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=720x960:fps=30,fade=t=in:st=0:d=0.7,format=yuv420p[v]"
  const aformat = 'aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo'
  const VOICE_FX = 'highpass=f=85,equalizer=f=250:width_type=q:w=1.2:g=2.5,equalizer=f=3200:width_type=q:w=1.6:g=1.5,equalizer=f=7200:width_type=q:w=2:g=-3.5,acompressor=threshold=-18dB:ratio=3:attack=20:release=200:makeup=2,aecho=0.9:0.85:18:0.10'

  const chains: string[] = [`[1:a]aresample=48000,${VOICE_FX},volume=1.0[voice]`]
  const mixLabels = ['[voice]']
  if (bgmIdx >= 0) { chains.push(`[${bgmIdx}:a]atrim=0:${durSec.toFixed(3)},aresample=48000,volume=${bgmVol}[bgm]`); mixLabels.push('[bgm]') }
  if (gearIdx >= 0) { chains.push(`[${gearIdx}:a]aresample=48000,atrim=0:${(sfx!.openEndSec).toFixed(3)},volume=0.7[gear]`); mixLabels.push('[gear]') }
  if (dropIdx >= 0) { chains.push(`[${dropIdx}:a]aresample=48000,adelay=${Math.round(sfx!.dropAtSec * 1000)}|${Math.round(sfx!.dropAtSec * 1000)},volume=0.6[drop]`); mixLabels.push('[drop]') }

  const afilter = mixLabels.length === 1
    ? `[1:a]aresample=48000,${VOICE_FX},loudnorm=I=-14:TP=-1:LRA=7,${aformat}[a]`
    : `${chains.join(';')};${mixLabels.join('')}amix=inputs=${mixLabels.length}:duration=first:normalize=0,alimiter=limit=0.95,loudnorm=I=-14:TP=-1:LRA=7,${aformat}[a]`

  args.push('-filter_complex', `${vfilter};${afilter}`, '-map', '[v]', '-map', '[a]',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-profile:v', 'high', '-c:a', 'aac', '-b:a', '192k',
    '-movflags', '+faststart', '-shortest', outAbs)
  return args
}
```

`renderVideo()` 调用处：flash 模式时传 sfx（gear/drop 路径 = `worker/assets/sfx/*`，openEndSec/dropAtSec 由 `flashTimeline` 用 bodyTimings[0] 与 books 数算出）与 `bgmVolume=params.audio.bgmVolume`；classic 传原参数（不带 sfx）。读取 params 用 `parseTemplateParams(framework.overlayTemplate.__templateParams)`（renderVideo 需 include framework）。

- [ ] **Step 4: 运行确认通过** — sfx 纯测 + 既有 renderVideo 测试全绿；`tsc` exit 0
- [ ] **Step 5: 提交** — `git commit -m "feat(flash): render-video SFX(齿轮/水滴)混音 + bgmVolume 参数化"`

---

## Task 9: 资源占位 + 本地真渲染验收

**Files:**
- Create: `worker/assets/sfx/gear.mp3`、`worker/assets/sfx/drop.mp3`（先从源工程复制作占位；README 注明后续换免版权）
- Create: `worker/templates/booklist/fonts/README.md`（说明放 `title.*`/`sub.*`，客户提供）
- Modify: 设计文档追加"实测结论"
- Temp（不入库）: `worker/__renderFlash.ts`

**Interfaces:** 无（集成验证）

- [ ] **Step 1: 放置 SFX 占位 + 字体说明**
```bash
mkdir -p worker/assets/sfx worker/templates/booklist/fonts
cp "今天分享的是/audio/7008917347213839630.mp3" worker/assets/sfx/gear.mp3
cp "今天分享的是/audio/6974688834588036388.mp3" worker/assets/sfx/drop.mp3
printf '客户字体放这里：title.ttf(书名/开场标题)、sub.otf(口播字幕)。\n缺失时渲染回退系统字体不报错。SFX 同理待换免版权。\n' > worker/templates/booklist/fonts/README.md
```

- [ ] **Step 2: 造一个 flash 框架并本地出片**（临时脚本：给现有余华任务的 framework 设 `overlayTemplate.__templateParams={mode:'flash'}` + `books`，重跑 generate-image(补书封)→…→render，或直接构造 BodyData 渲染）。抽帧。
- [ ] **Step 3: 抽帧对比源片**（Read frame PNG）：开场碎裂+「今天分享的是」→ 书封快闪逐本 → 叠化长镜头+白字幕。与 `今天分享的是/draft_cover.jpg` 及源结构比对。
- [ ] **Step 4: 若快闪糊/节奏偏**：调 `flash.perClipMs`/`minClipMs` 或书封生图风格，重渲。
- [ ] **Step 5: 清理临时脚本 + 文档追加实测结论**
- [ ] **Step 6: 提交** — `git commit -m "feat(flash): SFX/字体占位 + 本地真渲染验收结论"`

---

## Self-Review

**Spec coverage:**
- 参数化 schema + 时间线 → T1 ✅
- AI 书封(无字底图+叠名) → T2(提示词) + T3(生图) + T4(叠名) ✅
- 玻璃碎裂开场 → T6(复用 shardGrid/shardOpeningTweens) ✅
- 书单快闪(逐本封面) → T4 + T6 ✅
- 叠化长镜头 + 莫雪体白字幕下三分 → T5(参数化字幕CSS) + T6(固定叠化/字幕) ✅
- 音效层(齿轮/水滴)+BGM 0.69 → T8 ✅
- 字体内嵌(@font-face, 客户提供) → T5 + T7 + T9 ✅
- 全参数化 + P2 契约 → T1 schema ✅
- 与现有并存、classic 回归 → T6 回归测试 ✅
- 本地逐帧验收 → T9 ✅

**Placeholder scan:** 无 TBD/TODO；字体/SFX 为"客户提供/待换免版权"是明确的产品占位，非代码占位；每个 code step 含完整代码。

**Type consistency:**
- `TemplateParams`/`FlashTimeline` T1 定义，T3/T6/T7/T8 一致消费。
- `FlashCover{title,author?,coverSrc}` T4 定义，T6/T7 一致。
- `BodyData` 追加 `template/templateParams/flashCovers/fonts` T6 定义，T7 设值一致。
- `buildBookCoverPrompt`→`{prompt,negativePrompt}` T2 定义，T3 用一致。
- `resolveBooks` T3 定义并导出，T7 复用一致。
- `flashTimeline(p, seg0EndMs, bookCount)` T1 定义，T6/T8 调用一致。
- `buildFfmpegArgs` 新 opts T8 定义，`renderVideo()` 调用一致。

无缺口。计划就绪。
