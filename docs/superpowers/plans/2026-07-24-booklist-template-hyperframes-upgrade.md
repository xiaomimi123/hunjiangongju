# 书单号模板升级（运镜 + 美术）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把书单号自动出片的 codegen 从"手写单模板"重写为"按段确定性轮换的运镜库/转场库 + 设计 token + 3 套美术预设"，治好运镜木、美术糙，同时保持全自动流水线不变。

**Architecture:** 只重写 `worker/templates/booklist/` 下的 codegen（当前 415 行单文件），拆成 `util / theme / motion / captionsAnim / layout / indexHtml` 六个职责单一、可单测的纯模块。上游（script/image/tts/align）、渲染调用（`hyperframes@0.7.33 render`）、下游（render-video 混音）、以及 `renderVisuals.renderVisuals()` 主流程都不动；仅给 `BodyData` 增加 `style?`/`seed?` 两个字段并在 `buildBodyData` 里填充。

**Tech Stack:** TypeScript + vitest（现有）；产出自包含 `index.html`（GSAP paused timeline，本地 `gsap.min.js`）；HyperFrames 0.7.33 无头渲染。

## Global Constraints

- **不换引擎、不升版本**：继续 `hyperframes@0.7.33 render`；不改 `renderVisuals.ts` 的渲染调用段与 `render-video`。
- **Seek-safe**：所有 GSAP tween 必须是**字面量值**，禁止 function-based from/to；"逐字/分片"类效果初始态必须**烘焙进内联 style**，GSAP 只做 `to` 归位。产出 HTML **不得包含** `Math.random`。
- **不新增时长、不挪分段起止**：所有特效叠在既有 `startMs/endMs` 之上；timeline 总长 == `max(endMs)/1000`；任何 tween 位置 + 时长不得越过 `data-duration`。
- **无随机、可复现**：招式/转场/入场/预设的分配一律由 `seqNo` / `seed(genTaskId)` 派生纯函数；同输入产出逐字节一致。
- **契约不变**：`<main data-composition-id="main" data-start data-duration data-width data-height>` + `data-layout-ignore` 常驻层 + `window.__timelines["main"]` 挂 paused timeline + `<script src="gsap.min.js"></script>`（不得出现 `cdn.jsdelivr.net`）。
- **向后兼容**：旧任务（segment 无 `captionBeats`）必须仍能渲染，不抛错；无 `bookTitle` 时渲染开场标题卡，有则渲染常驻书名头。
- **画布**：720×960。

---

## File Structure

| 文件 | 职责 |
|---|---|
| `worker/templates/booklist/util.ts` | 共享纯函数 `esc`、`sec` |
| `worker/templates/booklist/theme.ts` | 3 套预设 token、`selectPreset`、`seedInt`、`rootVarsCss` |
| `worker/templates/booklist/motion.ts` | 运镜库 `MOVES`/`pickMove`/`moveTweens`/`beatAccent`；转场库 `TRANS`/`pickTrans`/`transTweens`；`shardGrid` |
| `worker/templates/booklist/captionsAnim.ts` | 字幕入场库 `ENTRANCES`/`pickEntrance`/`captionUnit`（含 char-stagger 烘焙） |
| `worker/templates/booklist/layout.ts` | `baseCss`（结构 CSS，引用 CSS 变量）、场景/标题卡/水印/书名头/暗角 HTML 片段 |
| `worker/templates/booklist/indexHtml.ts` | 编排器：拉齐 segments、算分配、组合上述模块 → 完整 HTML（重写） |
| `worker/src/gen/renderVisuals.ts` | 仅改：`buildBodyData` 增 `genTaskId` 入参、填 `data.style`/`data.seed`；调用点同步 |

每个模块配同名 `*.test.ts`；`indexHtml.test.ts` 从"断言精确 tween 字符串"改写为"断言不变量"。

---

## Task 1: 抽取共享工具 util.ts

把散落在 `indexHtml.ts` 的 `esc`/`sec` 抽成共享模块，供各模块复用（DRY）。

**Files:**
- Create: `worker/templates/booklist/util.ts`
- Test: `worker/templates/booklist/util.test.ts`

**Interfaces:**
- Produces:
  - `esc(s: string): string` — HTML 转义 `& < > "`
  - `sec(ms: number): number` — 毫秒→秒，保留 3 位小数（`Math.round(ms/1000*1000)/1000`）

- [ ] **Step 1: 写失败测试**

```ts
// worker/templates/booklist/util.test.ts
import { describe, it, expect } from 'vitest'
import { esc, sec } from './util'

describe('esc', () => {
  it('转义 HTML 特殊字符', () => {
    expect(esc('第一句 <字幕> & "x"')).toBe('第一句 &lt;字幕&gt; &amp; &quot;x&quot;')
  })
  it('null/undefined → 空串', () => {
    expect(esc(undefined as unknown as string)).toBe('')
    expect(esc(null as unknown as string)).toBe('')
  })
})

describe('sec', () => {
  it('毫秒转秒并保留 3 位小数', () => {
    expect(sec(4500)).toBe(4.5)
    expect(sec(2000)).toBe(2)
    expect(sec(1234)).toBe(1.234)
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run worker/templates/booklist/util.test.ts`
Expected: FAIL（`Cannot find module './util'`）

- [ ] **Step 3: 实现 util.ts**

```ts
// worker/templates/booklist/util.ts

/** HTML 文本转义，防止字幕/标题里的特殊字符破坏结构 */
export function esc(s: string): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** ms → 秒（保留 3 位小数，去掉浮点尾巴） */
export function sec(ms: number): number {
  return Math.round((ms / 1000) * 1000) / 1000
}
```

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run worker/templates/booklist/util.test.ts`
Expected: PASS（4 tests）

- [ ] **Step 5: 提交**

```bash
git add worker/templates/booklist/util.ts worker/templates/booklist/util.test.ts
git commit -m "refactor(booklist): 抽取共享 esc/sec 到 util.ts"
```

---

## Task 2: 设计 token 与 3 套预设 theme.ts

**Files:**
- Create: `worker/templates/booklist/theme.ts`
- Test: `worker/templates/booklist/theme.test.ts`

**Interfaces:**
- Produces:
  - `type PresetId = 'warm-literary' | 'dark-premium' | 'ink-oriental'`
  - `const PRESET_IDS: PresetId[]`（顺序即索引）
  - `seedInt(seed: string): number` — 由字符串派生的稳定非负整数（字符码累加）
  - `selectPreset(style: string | undefined, seed: string): PresetId` — 优先 `style` 精确命中 `PRESET_IDS`，否则 `PRESET_IDS[seedInt(seed) % 3]`
  - `rootVarsCss(preset: PresetId): string` — 返回 `:root{ --bg:...; ... }` 变量块字符串
  - `hasGrain(preset: PresetId): boolean` — 该预设是否叠颗粒层

- [ ] **Step 1: 写失败测试**

```ts
// worker/templates/booklist/theme.test.ts
import { describe, it, expect } from 'vitest'
import { PRESET_IDS, seedInt, selectPreset, rootVarsCss, hasGrain } from './theme'

describe('selectPreset', () => {
  it('style 精确命中预设 id 时直接采用', () => {
    expect(selectPreset('dark-premium', 'anything')).toBe('dark-premium')
    expect(selectPreset('ink-oriental', '')).toBe('ink-oriental')
  })
  it('style 缺省/非法 → 由 seed 稳定派生', () => {
    const a = selectPreset(undefined, 'task-abc')
    const b = selectPreset('not-a-preset', 'task-abc')
    expect(a).toBe(b) // 同 seed 稳定
    expect(PRESET_IDS).toContain(a)
  })
  it('不同 seed 可落到不同预设（覆盖 %3 分布）', () => {
    const got = new Set(['s0', 's1', 's2', 's3', 's4', 's5'].map((s) => selectPreset(undefined, s)))
    expect(got.size).toBeGreaterThan(1)
  })
})

describe('seedInt', () => {
  it('确定性、非负', () => {
    expect(seedInt('abc')).toBe(seedInt('abc'))
    expect(seedInt('abc')).toBeGreaterThanOrEqual(0)
  })
})

describe('rootVarsCss', () => {
  it('每套预设都产出必需的 CSS 变量', () => {
    for (const p of PRESET_IDS) {
      const css = rootVarsCss(p)
      for (const v of ['--bg', '--ink', '--ink-dim', '--accent', '--scrim', '--fs-title', '--fs-book', '--fs-cap-zh', '--fs-cap-en', '--font-title', '--font-body', '--font-en']) {
        expect(css).toContain(v)
      }
    }
  })
})

describe('hasGrain', () => {
  it('ink-oriental 开颗粒，其余关', () => {
    expect(hasGrain('ink-oriental')).toBe(true)
    expect(hasGrain('warm-literary')).toBe(false)
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run worker/templates/booklist/theme.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现 theme.ts**

```ts
// worker/templates/booklist/theme.ts
// 设计 token 与 3 套风格预设。预设整套切换（只覆盖 token），结构 CSS 在 layout.ts 用 var() 引用。

export type PresetId = 'warm-literary' | 'dark-premium' | 'ink-oriental'
export const PRESET_IDS: PresetId[] = ['warm-literary', 'dark-premium', 'ink-oriental']

interface Tokens {
  bg: string
  ink: string
  inkDim: string
  accent: string
  scrim: string
  fsTitle: number
  fsBook: number
  fsCapZh: number
  fsCapEn: number
  fontTitle: string
  fontBody: string
  fontEn: string
  grain: boolean
}

const SANS = '"PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif'
const SERIF = '"Songti SC", "STSong", "SimSun", serif'
const SCRIPT = '"Bradley Hand", "Segoe Script", "Snell Roundhand", cursive'

const PRESETS: Record<PresetId, Tokens> = {
  'warm-literary': {
    bg: '#14100c', ink: '#ffffff', inkDim: '#f0e6d2', accent: '#f2b84b',
    scrim: 'rgba(0,0,0,0.72)', fsTitle: 46, fsBook: 46, fsCapZh: 36, fsCapEn: 22,
    fontTitle: SERIF, fontBody: SANS, fontEn: SCRIPT, grain: false,
  },
  'dark-premium': {
    bg: '#0b0b0d', ink: '#ffffff', inkDim: '#c9c9cf', accent: '#d4af6a',
    scrim: 'rgba(0,0,0,0.80)', fsTitle: 44, fsBook: 44, fsCapZh: 36, fsCapEn: 22,
    fontTitle: SANS, fontBody: SANS, fontEn: SCRIPT, grain: false,
  },
  'ink-oriental': {
    bg: '#12100e', ink: '#f6f1e6', inkDim: '#e8dfcf', accent: '#c1272d',
    scrim: 'rgba(0,0,0,0.70)', fsTitle: 48, fsBook: 48, fsCapZh: 36, fsCapEn: 22,
    fontTitle: SERIF, fontBody: SERIF, fontEn: SCRIPT, grain: true,
  },
}

/** 字符串 → 稳定非负整数（字符码累加），用于 seed 派生 */
export function seedInt(seed: string): number {
  let acc = 0
  for (const c of String(seed ?? '')) acc += c.charCodeAt(0)
  return acc
}

/** 选预设：style 精确命中优先，否则 seed 稳定派生 */
export function selectPreset(style: string | undefined, seed: string): PresetId {
  if (style && (PRESET_IDS as string[]).includes(style)) return style as PresetId
  return PRESET_IDS[seedInt(seed) % PRESET_IDS.length]
}

export function hasGrain(preset: PresetId): boolean {
  return PRESETS[preset].grain
}

/** 返回 :root 的 CSS 变量块 */
export function rootVarsCss(preset: PresetId): string {
  const t = PRESETS[preset]
  return `    :root {
      --bg: ${t.bg};
      --ink: ${t.ink};
      --ink-dim: ${t.inkDim};
      --accent: ${t.accent};
      --scrim: ${t.scrim};
      --fs-title: ${t.fsTitle}px;
      --fs-book: ${t.fsBook}px;
      --fs-cap-zh: ${t.fsCapZh}px;
      --fs-cap-en: ${t.fsCapEn}px;
      --font-title: ${t.fontTitle};
      --font-body: ${t.fontBody};
      --font-en: ${t.fontEn};
    }`
}
```

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run worker/templates/booklist/theme.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add worker/templates/booklist/theme.ts worker/templates/booklist/theme.test.ts
git commit -m "feat(booklist): 设计 token + 3 套风格预设 theme.ts"
```

---

## Task 3: 运镜库 motion.ts（moves 部分）

**Files:**
- Create: `worker/templates/booklist/motion.ts`
- Test: `worker/templates/booklist/motion.test.ts`

**Interfaces:**
- Consumes: `sec` from `./util`
- Produces（本任务）:
  - `type MoveId = 'push-in' | 'pull-back' | 'pan-right' | 'pan-left' | 'drift-up' | 'tilt-settle'`
  - `const MOVES: MoveId[]`
  - `pickMove(seqNo: number, offset: number): MoveId` — `MOVES[(seqNo + offset) % MOVES.length]`
  - `moveTweens(move: MoveId, n: number, startMs: number, endMs: number, isLast: boolean): string` — 针对 `.sN .photo` 的字面量 GSAP tween 行，位置 `sec(startMs)`，时长 `sec(endMs-startMs)+1.2`
  - `beatAccent(n: number, atMs: number): string` — 在 `sec(atMs)` 处对 `.sN .photo` 叠 0.12s scale 微脉冲

- [ ] **Step 1: 写失败测试**

```ts
// worker/templates/booklist/motion.test.ts
import { describe, it, expect } from 'vitest'
import { MOVES, pickMove, moveTweens, beatAccent } from './motion'

describe('pickMove', () => {
  it('确定性、相邻 seqNo 不撞招', () => {
    expect(pickMove(1, 0)).toBe(pickMove(1, 0))
    expect(pickMove(1, 0)).not.toBe(pickMove(2, 0))
  })
  it('offset 移动轮换相位', () => {
    expect(pickMove(1, 0)).not.toBe(pickMove(1, 1))
  })
})

describe('moveTweens', () => {
  it('针对 .sN .photo，位置=startMs 秒，无 function-based 值', () => {
    const out = moveTweens('push-in', 2, 2000, 4500, false)
    expect(out).toContain(".s2 .photo'")
    expect(out).toContain(', 2)') // 起点秒
    expect(out).not.toContain('function')
    expect(out).not.toContain('=>')
  })
  it('末段 push-in 目标幅度更大(1.16)', () => {
    expect(moveTweens('push-in', 3, 4000, 6000, true)).toContain('scale: 1.16')
    expect(moveTweens('push-in', 1, 0, 2000, false)).toContain('scale: 1.105')
  })
  it('每种招式都能产出针对 .photo 的 tween', () => {
    for (const m of MOVES) {
      const out = moveTweens(m, 1, 0, 2000, false)
      expect(out).toContain(".s1 .photo'")
      expect(out).toContain('duration:')
    }
  })
})

describe('beatAccent', () => {
  it('在给定秒处对 .sN .photo 叠短脉冲', () => {
    const out = beatAccent(2, 2000)
    expect(out).toContain(".s2 .photo'")
    expect(out).toContain(', 2)')
    expect(out).toContain('duration: 0.12')
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run worker/templates/booklist/motion.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现 motion.ts（moves 部分）**

```ts
// worker/templates/booklist/motion.ts
// 运镜库 + 转场库。全部产出字面量 GSAP tween 字符串（seek-safe，无 function-based 值）。
import { sec } from './util'

export type MoveId = 'push-in' | 'pull-back' | 'pan-right' | 'pan-left' | 'drift-up' | 'tilt-settle'
export const MOVES: MoveId[] = ['push-in', 'pull-back', 'pan-right', 'pan-left', 'drift-up', 'tilt-settle']

export function pickMove(seqNo: number, offset: number): MoveId {
  return MOVES[(((seqNo + offset) % MOVES.length) + MOVES.length) % MOVES.length]
}

/**
 * 场景运镜：对 .sN .photo 施加跨整段时间窗的缓慢位移/缩放。
 * pushDur 比段长多 1.2s，保证段末仍在运动（避免定格死板）。所有值字面量。
 * .photo 有 inset:-30px 余量，横摇/上移的 ±24px 不会露底。
 */
export function moveTweens(move: MoveId, n: number, startMs: number, endMs: number, isLast: boolean): string {
  const startSec = sec(startMs)
  const segLenSec = Math.max(0.1, sec(endMs - startMs))
  const dur = Math.round((segLenSec + 1.2) * 1000) / 1000
  const sel = `'.s${n} .photo'`
  const t = (from: string, to: string) =>
    `  tl.fromTo(${sel}, ${from}, { ${to}, duration: ${dur}, ease: 'sine.inOut' }, ${startSec});`
  const pushTo = isLast ? 1.16 : 1.105
  switch (move) {
    case 'push-in':
      return t(`{ scale: 1.035 }`, `scale: ${pushTo}`)
    case 'pull-back':
      return t(`{ scale: ${isLast ? 1.2 : 1.14} }`, `scale: 1.04`)
    case 'pan-right':
      return t(`{ scale: 1.1, x: -24 }`, `x: 24`)
    case 'pan-left':
      return t(`{ scale: 1.1, x: 24 }`, `x: -24`)
    case 'drift-up':
      return t(`{ scale: 1.1, y: 24 }`, `y: -24`)
    case 'tilt-settle':
      return t(`{ scale: 1.12, rotation: -2 }`, `scale: 1.06, rotation: 0`)
  }
}

/** 字幕首拍咬合：段起拍处对 .sN .photo 叠 0.12s scale 微脉冲，制造节奏重音。 */
export function beatAccent(n: number, atMs: number): string {
  const at = sec(atMs)
  return (
    `  tl.to('.s${n} .photo', { scale: '+=0.012', duration: 0.12, ease: 'power2.out', yoyo: true, repeat: 1 }, ${at});`
  )
}
```

> 说明：`beatAccent` 用 `'+=0.012'` 相对量 + `yoyo/repeat:1` 做脉冲后回落。相对字符串是 GSAP 支持的字面量语法（非 function-based），seek-safe。

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run worker/templates/booklist/motion.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add worker/templates/booklist/motion.ts worker/templates/booklist/motion.test.ts
git commit -m "feat(booklist): 运镜库(6 招式)+节拍重音 motion.ts"
```

---

## Task 4: 转场库 + 碎片网格 motion.ts（transitions 部分）

在 Task 3 的 `motion.ts` 上追加转场库与 `shardGrid`。

**Files:**
- Modify: `worker/templates/booklist/motion.ts`
- Test: `worker/templates/booklist/motion.test.ts`（追加）

**Interfaces:**
- Consumes: `esc` from `./util`
- Produces（本任务）:
  - `type TransId = 'crossfade' | 'wipe' | 'shard' | 'glide-push' | 'blur-dissolve'`
  - `const TRANS: TransId[]`
  - `pickTrans(seqNo: number, offset: number): TransId` — `TRANS[(seqNo + offset) % TRANS.length]`
  - `transTweens(trans: TransId, n: number, boundaryMs: number): string` — 进入场景 n（上一场景 n-1）的转场 tween，全部落在 `boundarySec` 起的 0.72s 窗内
  - `shardGrid(opts: { containerClass: string; imgSrc: string; cols: number; rows: number; width: number; height: number; startScattered?: boolean }): string` — 碎片网格 HTML（初始打散态烘焙内联，不用 Math.random）
  - `shardOpeningTweens(): string` — 首场景玻璃碎片开场 tween（作用于 `.s1shatter .shard` / `.s1 .photo` / `.s1shatter`）
  - `shardTransTweens(n: number, boundaryMs: number): string` — 供 `transTweens` 的 `shard` 分支使用（作用于 `.tsN .shard`）

- [ ] **Step 1: 追加失败测试**

```ts
// 追加到 worker/templates/booklist/motion.test.ts
import { TRANS, pickTrans, transTweens, shardGrid, shardOpeningTweens } from './motion'

describe('pickTrans', () => {
  it('确定性、相邻边界不撞', () => {
    expect(pickTrans(2, 0)).toBe(pickTrans(2, 0))
    expect(pickTrans(2, 0)).not.toBe(pickTrans(3, 0))
  })
})

describe('transTweens', () => {
  it('每种转场都落在 boundarySec 起的 0.72s 窗内，且操作新旧场景', () => {
    for (const tr of TRANS) {
      const out = transTweens(tr, 2, 2000)
      expect(out).toContain('.s2') // 新场景
      expect(out).toContain('.s1') // 旧场景
      expect(out).not.toContain('function')
      expect(out).not.toContain('=>')
      // 位置起点为 2 秒（boundaryMs=2000）
      expect(out).toContain(', 2)')
    }
  })
  it('crossfade：新场景淡入、旧场景淡出', () => {
    const out = transTweens('crossfade', 2, 2000)
    expect(out).toContain("tl.fromTo('.s2', { opacity: 0 }, { opacity: 1, duration: 0.72")
    expect(out).toContain("tl.to('.s1', { opacity: 0, duration: 0.72")
  })
  it('shard：驱动 .ts2 碎片层', () => {
    expect(transTweens('shard', 2, 2000)).toContain(".ts2 .shard'")
  })
})

describe('shardGrid', () => {
  it('cols×rows 片、烘焙内联、无 Math.random', () => {
    const html = shardGrid({ containerClass: 'shatter s1shatter', imgSrc: 'media/01.png', cols: 4, rows: 5, width: 720, height: 960, startScattered: true })
    expect((html.match(/class="shard"/g) ?? []).length).toBe(20)
    expect(html).toContain("background-image:url('media/01.png');background-size:720px 960px")
    expect(html).toContain('transform:translate(')
    expect(html).not.toContain('Math.random')
  })
})

describe('shardOpeningTweens', () => {
  it('t=0 起碎片归位、真实图隐藏后淡入接手', () => {
    const out = shardOpeningTweens()
    expect(out).toContain("tl.set('.s1 .photo', { opacity: 0 }, 0);")
    expect(out).toContain("tl.to('.s1shatter .shard'")
    expect(out).toContain("stagger: { amount: 0.45, from: 'center' } }, 0);")
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run worker/templates/booklist/motion.test.ts`
Expected: FAIL（新导出不存在）

- [ ] **Step 3: 追加实现到 motion.ts**

```ts
// 追加到 worker/templates/booklist/motion.ts（在文件末尾；补充顶部 import）
// 顶部 import 改为： import { sec, esc } from './util'

export type TransId = 'crossfade' | 'wipe' | 'shard' | 'glide-push' | 'blur-dissolve'
export const TRANS: TransId[] = ['crossfade', 'wipe', 'shard', 'glide-push', 'blur-dissolve']

export function pickTrans(seqNo: number, offset: number): TransId {
  return TRANS[(((seqNo + offset) % TRANS.length) + TRANS.length) % TRANS.length]
}

const W = 0.72 // crossfade 窗口秒数（所有转场共用，不占额外时长）

/** 进入场景 n（上一场景 n-1）的转场，全部落在 boundarySec 起的 0.72s 窗内。 */
export function transTweens(trans: TransId, n: number, boundaryMs: number): string {
  const b = sec(boundaryMs)
  const nw = `'.s${n}'`
  const pv = `'.s${n - 1}'`
  const lines: string[] = []
  switch (trans) {
    case 'crossfade':
      lines.push(`  tl.fromTo(${nw}, { opacity: 0 }, { opacity: 1, duration: ${W}, ease: 'sine.inOut' }, ${b});`)
      lines.push(`  tl.to(${pv}, { opacity: 0, duration: ${W}, ease: 'sine.inOut' }, ${b});`)
      break
    case 'wipe':
      lines.push(`  tl.set(${nw}, { opacity: 1 }, ${b});`)
      lines.push(`  tl.fromTo(${nw}, { clipPath: 'inset(0 100% 0 0)' }, { clipPath: 'inset(0 0% 0 0)', duration: ${W}, ease: 'power2.inOut' }, ${b});`)
      lines.push(`  tl.set(${pv}, { opacity: 0 }, ${Math.round((b + W) * 1000) / 1000});`)
      break
    case 'shard':
      lines.push(`  tl.fromTo(${nw}, { opacity: 0 }, { opacity: 1, duration: ${W}, ease: 'sine.inOut' }, ${b});`)
      lines.push(`  tl.set(${pv}, { opacity: 0 }, ${b});`)
      lines.push(shardTransTweens(n, boundaryMs))
      break
    case 'glide-push':
      lines.push(`  tl.set(${nw}, { opacity: 1 }, ${b});`)
      lines.push(`  tl.fromTo(${nw}, { xPercent: 100 }, { xPercent: 0, duration: ${W}, ease: 'power3.out' }, ${b});`)
      lines.push(`  tl.to(${pv}, { xPercent: -40, opacity: 0, duration: ${W}, ease: 'power3.out' }, ${b});`)
      break
    case 'blur-dissolve':
      lines.push(`  tl.fromTo(${nw}, { opacity: 0, filter: 'blur(18px)' }, { opacity: 1, filter: 'blur(0px)', duration: ${W}, ease: 'sine.inOut' }, ${b});`)
      lines.push(`  tl.to(${pv}, { opacity: 0, filter: 'blur(18px)', duration: ${W}, ease: 'sine.inOut' }, ${b});`)
      break
  }
  return lines.join('\n')
}

/**
 * 碎片网格：把一张图切成 cols×rows 个 .shard 绝对定位块，每块用负偏移背景显示自己那格。
 * startScattered=true 时把「打散」初始 transform/opacity 烘焙进内联（GSAP 只 to 归位，seek-safe）。
 */
export function shardGrid(opts: {
  containerClass: string
  imgSrc: string
  cols: number
  rows: number
  width: number
  height: number
  startScattered?: boolean
}): string {
  const { containerClass, imgSrc, cols, rows, width, height, startScattered } = opts
  const cellW = width / cols
  const cellH = height / rows
  const shards: string[] = []
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const idx = r * cols + c
      const left = Math.round(c * cellW)
      const top = Math.round(r * cellH)
      const w = Math.round(cellW) + 1
      const h = Math.round(cellH) + 1
      let scatter = ''
      if (startScattered) {
        const dx = Math.round(Math.sin(idx * 1.7) * 240 + (idx % 2 === 0 ? 70 : -70))
        const dy = Math.round(Math.cos(idx * 2.1) * 200 - 30)
        const dr = Math.round(Math.sin(idx * 3.3) * 55)
        scatter = `transform:translate(${dx}px,${dy}px) rotate(${dr}deg) scale(1.15);opacity:0.15;`
      }
      shards.push(
        `      <div class="shard" style="left:${left}px;top:${top}px;width:${w}px;height:${h}px;` +
          `background-image:url('${esc(imgSrc)}');background-size:${width}px ${height}px;` +
          `background-position:-${left}px -${top}px;${scatter}"></div>`,
      )
    }
  }
  return `    <div class="${containerClass}" data-layout-ignore>\n${shards.join('\n')}\n    </div>`
}

/** 首场景玻璃碎片开场：t=0 起碎片 stagger 归位，0.82s 真实图淡入接手，0.88s 碎片层淡出。 */
export function shardOpeningTweens(): string {
  return [
    `  tl.set('.s1 .photo', { opacity: 0 }, 0);`,
    `  tl.to('.s1shatter .shard', { x: 0, y: 0, rotation: 0, scale: 1, opacity: 1, duration: 0.65, ease: 'power3.out', stagger: { amount: 0.45, from: 'center' } }, 0);`,
    `  tl.to('.s1 .photo', { opacity: 1, duration: 0.2, ease: 'sine.inOut' }, 0.82);`,
    `  tl.to('.s1shatter', { opacity: 0, duration: 0.25, ease: 'sine.inOut' }, 0.88);`,
  ].join('\n')
}

/** shard 转场：上一场景碎片层随 crossfade 同刻碎裂散开。 */
export function shardTransTweens(n: number, boundaryMs: number): string {
  const b = sec(boundaryMs)
  const hideAt = Math.round((b + W) * 1000) / 1000
  return [
    `  tl.set('.ts${n}', { opacity: 1 }, ${b});`,
    `  tl.to('.ts${n} .shard', { scale: 1.3, y: -50, rotation: 12, opacity: 0, duration: 0.5, ease: 'power1.in', stagger: { amount: 0.26, from: 'edges' } }, ${b});`,
    `  tl.set('.ts${n}', { opacity: 0 }, ${hideAt});`,
  ].join('\n')
}
```

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run worker/templates/booklist/motion.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add worker/templates/booklist/motion.ts worker/templates/booklist/motion.test.ts
git commit -m "feat(booklist): 转场库(5 种)+碎片网格 motion.ts"
```

---

## Task 5: 字幕入场库 captionsAnim.ts

**Files:**
- Create: `worker/templates/booklist/captionsAnim.ts`
- Test: `worker/templates/booklist/captionsAnim.test.ts`

**Interfaces:**
- Consumes: `esc`, `sec` from `./util`
- Produces:
  - `type EntranceId = 'fade-up' | 'mask-reveal' | 'char-stagger' | 'slide-in'`
  - `const ENTRANCES: EntranceId[]` — **char-stagger 的 seek-safety 由 Task 8 验证；若失效，从本数组移除即降级**
  - `pickEntrance(capIndex: number, offset: number): EntranceId`
  - `captionUnit(p: { n: number; entrance: EntranceId; zh: string; en?: string; startMs: number; endMs: number }): { html: string; tweens: string }` — 返回该字幕单元的 HTML（`.cap.capN` 含 `.cap-zh`/`.cap-en`）与 GSAP tween；结尾统一在 `endMs` 处 `set opacity 0`

- [ ] **Step 1: 写失败测试**

```ts
// worker/templates/booklist/captionsAnim.test.ts
import { describe, it, expect } from 'vitest'
import { ENTRANCES, pickEntrance, captionUnit } from './captionsAnim'

describe('pickEntrance', () => {
  it('确定性且随 index 轮换', () => {
    expect(pickEntrance(0, 0)).toBe(pickEntrance(0, 0))
    expect(pickEntrance(0, 0)).not.toBe(pickEntrance(1, 0))
  })
})

describe('captionUnit', () => {
  it('产出 .capN 容器与中文，转义特殊字符', () => {
    const u = captionUnit({ n: 1, entrance: 'fade-up', zh: '第一句 <x>', startMs: 0, endMs: 2000 })
    expect(u.html).toContain('class="cap cap1" data-layout-ignore')
    expect(u.html).toContain('第一句 &lt;x&gt;')
    expect(u.tweens).toContain(".cap1'")
  })
  it('入场 tween 起点=startMs 秒，结尾在 endMs 秒收起', () => {
    const u = captionUnit({ n: 2, entrance: 'fade-up', zh: '句', startMs: 2000, endMs: 4500 })
    expect(u.tweens).toContain(', 2)') // 入场起点
    expect(u.tweens).toContain("tl.set('.cap2', { opacity: 0 }, 4.5)")
  })
  it('有 en 时渲染 .cap-en', () => {
    const u = captionUnit({ n: 1, entrance: 'fade-up', zh: 'z', en: 'hello', startMs: 0, endMs: 1000 })
    expect(u.html).toContain('class="cap-en"')
    expect(u.html).toContain('hello')
  })
  it('无 en 时不渲染 .cap-en', () => {
    const u = captionUnit({ n: 1, entrance: 'fade-up', zh: 'z', startMs: 0, endMs: 1000 })
    expect(u.html).not.toContain('cap-en')
  })
  it('char-stagger：中文逐字拆 span、初始态烘焙内联、GSAP 只 to 归位', () => {
    const u = captionUnit({ n: 1, entrance: 'char-stagger', zh: '三个字', startMs: 0, endMs: 2000 })
    expect((u.html.match(/class="ch"/g) ?? []).length).toBe(3)
    expect(u.html).toContain('opacity:0') // 烘焙初始态
    expect(u.tweens).toContain(".cap1 .ch'")
    expect(u.tweens).not.toContain('function')
  })
  it('所有入场型都无 function-based 值', () => {
    for (const e of ENTRANCES) {
      const u = captionUnit({ n: 1, entrance: e, zh: '字', startMs: 0, endMs: 1000 })
      expect(u.tweens).not.toContain('function')
      expect(u.tweens).not.toContain('=>')
    }
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run worker/templates/booklist/captionsAnim.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现 captionsAnim.ts**

```ts
// worker/templates/booklist/captionsAnim.ts
// 字幕节拍入场库。每拍一个 .capN 单元；入场型按 index 轮换。全部 seek-safe。
import { esc, sec } from './util'

export type EntranceId = 'fade-up' | 'mask-reveal' | 'char-stagger' | 'slide-in'
// char-stagger 的无头 seek 兼容性由集成验证（Task 8）确认；若失效从此数组移除即完成降级。
export const ENTRANCES: EntranceId[] = ['fade-up', 'mask-reveal', 'char-stagger', 'slide-in']

export function pickEntrance(capIndex: number, offset: number): EntranceId {
  return ENTRANCES[(((capIndex + offset) % ENTRANCES.length) + ENTRANCES.length) % ENTRANCES.length]
}

export function captionUnit(p: {
  n: number
  entrance: EntranceId
  zh: string
  en?: string
  startMs: number
  endMs: number
}): { html: string; tweens: string } {
  const { n, entrance, zh, en, startMs, endMs } = p
  const s = sec(startMs)
  const e = sec(endMs)
  const enLine = en && en.trim() ? `\n      <div class="cap-en">${esc(en.trim())}</div>` : ''

  // char-stagger 需要逐字 span，其余用整块 .cap-zh
  const zhHtml =
    entrance === 'char-stagger'
      ? `<div class="cap-zh">${Array.from(zh)
          .map((ch) => `<span class="ch" style="opacity:0;transform:translateY(10px);display:inline-block">${esc(ch)}</span>`)
          .join('')}</div>`
      : `<div class="cap-zh">${esc(zh)}</div>`

  const html =
    `    <div class="cap cap${n}" data-layout-ignore>\n` +
    `      ${zhHtml}${enLine}\n` +
    `    </div>`

  const sel = `'.cap${n}'`
  const inLines: string[] = []
  switch (entrance) {
    case 'fade-up':
      inLines.push(`  tl.fromTo(${sel}, { opacity: 0, y: 14 }, { opacity: 1, y: 0, duration: 0.22, ease: 'power2.out' }, ${s});`)
      break
    case 'mask-reveal':
      inLines.push(`  tl.set(${sel}, { opacity: 1 }, ${s});`)
      inLines.push(`  tl.fromTo(${sel}, { clipPath: 'inset(0 100% 0 0)' }, { clipPath: 'inset(0 0% 0 0)', duration: 0.3, ease: 'power2.out' }, ${s});`)
      break
    case 'slide-in':
      inLines.push(`  tl.fromTo(${sel}, { opacity: 0, x: -40 }, { opacity: 1, x: 0, duration: 0.26, ease: 'power3.out' }, ${s});`)
      break
    case 'char-stagger':
      inLines.push(`  tl.set(${sel}, { opacity: 1 }, ${s});`)
      inLines.push(`  tl.to('.cap${n} .ch', { opacity: 1, y: 0, duration: 0.24, ease: 'power2.out', stagger: { amount: 0.18, from: 'start' } }, ${s});`)
      break
  }
  inLines.push(`  tl.set(${sel}, { opacity: 0 }, ${e});`)

  return { html, tweens: inLines.join('\n') }
}
```

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run worker/templates/booklist/captionsAnim.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add worker/templates/booklist/captionsAnim.ts worker/templates/booklist/captionsAnim.test.ts
git commit -m "feat(booklist): 字幕入场库(4 型,含逐字浮现) captionsAnim.ts"
```

---

## Task 6: 结构 CSS 与 HTML 片段 layout.ts

**Files:**
- Create: `worker/templates/booklist/layout.ts`
- Test: `worker/templates/booklist/layout.test.ts`

**Interfaces:**
- Consumes: `esc` from `./util`；`hasGrain` from `./theme`
- Produces:
  - `baseCss(preset: import('./theme').PresetId): string` — 结构 CSS（全部用 `var(--...)`）；含 `.scene`/`.photo(inset:-30px)`/`.bg-fill`/`.shatter`/`.tshatter`/`.shard`/`.vignette`/`.grain`/`.title-card`/`.book-header`/`.cap`/`.watermark`；`ink-oriental` 追加 `.grain{opacity:...}` 显示
  - `sceneHtml(n: number, imgSrc: string): string` — `.scene.sN`（含模糊背景填充 `.bg-fill` + 主图 `.photo`）
  - `titleCardHtml(title: string, subtitle: string): string`
  - `watermarkHtml(text: string): string`
  - `bookHeaderHtml(n: number, title: string, author?: string): string`
  - `overlayDecorHtml(preset: import('./theme').PresetId): string` — 暗角 `.vignette` +（若 `hasGrain`）颗粒层 `.grain`

- [ ] **Step 1: 写失败测试**

```ts
// worker/templates/booklist/layout.test.ts
import { describe, it, expect } from 'vitest'
import { baseCss, sceneHtml, titleCardHtml, watermarkHtml, bookHeaderHtml, overlayDecorHtml } from './layout'

describe('baseCss', () => {
  it('结构 CSS 用 CSS 变量、.photo 留 -30px 余量', () => {
    const css = baseCss('warm-literary')
    expect(css).toContain('var(--bg)')
    expect(css).toContain('var(--fs-cap-zh)')
    expect(css).toContain('inset: -30px')
    expect(css).toContain('.scrim') // 字幕压暗底
  })
})

describe('sceneHtml', () => {
  it('含模糊背景填充与主图', () => {
    const html = sceneHtml(2, 'media/02.png')
    expect(html).toContain('class="scene s2"')
    expect(html).toContain('class="bg-fill"')
    expect(html).toContain('class="photo"')
    expect(html).toContain("url('media/02.png')")
  })
})

describe('titleCardHtml / watermarkHtml / bookHeaderHtml', () => {
  it('标题卡带 data-layout-ignore 与转义', () => {
    expect(titleCardHtml('《活着 <x>》', '余华')).toContain('class="title-card" data-layout-ignore')
    expect(titleCardHtml('《活着 <x>》', '余华')).toContain('&lt;x&gt;')
  })
  it('无副标题时不渲染副标题行', () => {
    expect(titleCardHtml('T', '')).not.toContain('tc-subtitle')
  })
  it('水印转义', () => {
    expect(watermarkHtml('@号 <a>')).toContain('class="watermark" data-layout-ignore')
    expect(watermarkHtml('@号 <a>')).toContain('&lt;a&gt;')
  })
  it('书名头带 kicker 与作者', () => {
    const h = bookHeaderHtml(1, '活着', '余华')
    expect(h).toContain('class="book-header bh1" data-layout-ignore')
    expect(h).toContain('bh-kicker')
    expect(h).toContain('《活着》')
    expect(h).toContain('余华')
  })
})

describe('overlayDecorHtml', () => {
  it('总有暗角；ink-oriental 追加颗粒层', () => {
    expect(overlayDecorHtml('warm-literary')).toContain('class="vignette"')
    expect(overlayDecorHtml('warm-literary')).not.toContain('class="grain"')
    expect(overlayDecorHtml('ink-oriental')).toContain('class="grain"')
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run worker/templates/booklist/layout.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现 layout.ts**

```ts
// worker/templates/booklist/layout.ts
// 结构 CSS（引用 theme 的 CSS 变量）与 HTML 片段构造。美术 token 全部来自 var(--...)。
import { esc } from './util'
import { hasGrain, type PresetId } from './theme'

export function baseCss(_preset: PresetId): string {
  return `    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body {
      width: 720px; height: 960px; background: var(--bg); overflow: hidden;
      font-family: var(--font-body);
    }
    #root { position: relative; width: 720px; height: 960px; overflow: hidden; background: var(--bg); }
    .scene { position: absolute; inset: 0; opacity: 0; overflow: hidden; }
    /* 背景模糊填充：非等比图不再露底，用同图放大模糊铺底 */
    .scene .bg-fill {
      position: absolute; inset: -40px; background-size: cover; background-position: center;
      filter: blur(28px) brightness(0.6); transform: scale(1.1);
    }
    .scene .photo {
      position: absolute; inset: -30px; background-size: contain; background-repeat: no-repeat;
      background-position: center; will-change: transform;
    }
    .shatter, .tshatter { position: absolute; inset: 0; z-index: 10; pointer-events: none; }
    .shard { position: absolute; overflow: hidden; will-change: transform, opacity; }
    /* 字幕压暗底：保证任意底图上字幕清晰 */
    .scrim {
      position: absolute; left: 0; right: 0; bottom: 0; height: 340px; z-index: 13;
      background: linear-gradient(to top, var(--scrim) 0%, rgba(0,0,0,0) 100%); pointer-events: none;
    }
    .vignette {
      position: absolute; inset: 0; z-index: 12; opacity: 0; pointer-events: none;
      background: radial-gradient(ellipse at center, rgba(0,0,0,0) 42%, rgba(0,0,0,0.72) 100%);
    }
    /* 颗粒层：仅带 grain 的预设渲染，增质感 */
    .grain {
      position: absolute; inset: 0; z-index: 14; opacity: 0.06; pointer-events: none; mix-blend-mode: overlay;
      background-image: radial-gradient(rgba(255,255,255,0.9) 0.5px, transparent 0.5px);
      background-size: 3px 3px;
    }
    .title-card {
      position: absolute; top: 48px; left: 0; right: 0; text-align: center; padding: 0 40px;
      opacity: 1; z-index: 20; text-shadow: 0 2px 12px rgba(0,0,0,0.65);
    }
    .tc-title { color: var(--ink); font-size: var(--fs-title); font-weight: 800; line-height: 1.2; font-family: var(--font-title); }
    .tc-subtitle { color: var(--ink-dim); font-size: 26px; font-weight: 500; margin-top: 10px; }
    .book-header {
      position: absolute; top: 48px; left: 0; right: 0; text-align: center; padding: 0 40px;
      opacity: 0; z-index: 20; text-shadow: 0 2px 12px rgba(0,0,0,0.65);
    }
    .bh-kicker { display: inline-block; width: 46px; height: 4px; background: var(--accent); border-radius: 2px; margin-bottom: 14px; }
    .bh-title { color: var(--ink); font-size: var(--fs-book); font-weight: 800; line-height: 1.2; font-family: var(--font-title); }
    .bh-author { color: var(--accent); font-size: 26px; font-weight: 600; margin-top: 10px; }
    .cap { position: absolute; left: 40px; right: 40px; bottom: 150px; text-align: center; opacity: 0; z-index: 15; }
    .cap-zh { color: var(--ink); font-size: var(--fs-cap-zh); font-weight: 700; line-height: 1.4; text-shadow: 0 2px 10px rgba(0,0,0,0.8); }
    .cap-en { color: var(--ink-dim); font-size: var(--fs-cap-en); font-style: italic; font-weight: 500; line-height: 1.3; margin-top: 8px; text-shadow: 0 2px 8px rgba(0,0,0,0.7); font-family: var(--font-en); }
    .watermark {
      position: absolute; left: 0; right: 0; bottom: 56px; text-align: center;
      color: rgba(255,255,255,0.82); font-size: 24px; font-weight: 600; opacity: 1; z-index: 20;
      text-shadow: 0 2px 8px rgba(0,0,0,0.6);
    }`
}

export function sceneHtml(n: number, imgSrc: string): string {
  return (
    `    <div class="scene s${n}" data-layout-ignore>\n` +
    `      <div class="bg-fill" style="background-image:url('${esc(imgSrc)}')"></div>\n` +
    `      <div class="photo" style="background-image:url('${esc(imgSrc)}')"></div>\n` +
    `    </div>`
  )
}

export function titleCardHtml(title: string, subtitle: string): string {
  const sub = subtitle && subtitle.trim() ? `\n      <div class="tc-subtitle">${esc(subtitle)}</div>` : ''
  return (
    `    <div class="title-card" data-layout-ignore>\n` +
    `      <div class="tc-title">${esc(title)}</div>${sub}\n` +
    `    </div>`
  )
}

export function watermarkHtml(text: string): string {
  if (!text) return ''
  return `    <div class="watermark" data-layout-ignore>${esc(text)}</div>`
}

export function bookHeaderHtml(n: number, title: string, author?: string): string {
  const authorLine = author && author.trim() ? `\n      <div class="bh-author">${esc(author)} / 著</div>` : ''
  return (
    `    <div class="book-header bh${n}" data-layout-ignore>\n` +
    `      <div class="bh-kicker"></div>\n` +
    `      <div class="bh-title">《${esc(title)}》</div>${authorLine}\n` +
    `    </div>`
  )
}

export function overlayDecorHtml(preset: PresetId): string {
  const grain = hasGrain(preset) ? `\n    <div class="grain" data-layout-ignore></div>` : ''
  return `    <div class="vignette" data-layout-ignore></div>${grain}`
}
```

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run worker/templates/booklist/layout.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add worker/templates/booklist/layout.ts worker/templates/booklist/layout.test.ts
git commit -m "feat(booklist): 结构 CSS(变量驱动)+字幕压暗底/模糊填充/书名头kicker layout.ts"
```

---

## Task 7: 编排器重写 indexHtml.ts + BodyData 扩字段

把 `renderIndexHtml` 重写为编排器：选预设 → 算 offset → 逐段选运镜/转场 → 组合 layout/motion/captionsAnim → 拼完整 HTML。`BodyData` 增 `style?`/`seed?`。**改写** `indexHtml.test.ts` 为不变量断言。

**Files:**
- Modify (重写): `worker/templates/booklist/indexHtml.ts`
- Modify (改写): `worker/templates/booklist/indexHtml.test.ts`

**Interfaces:**
- Consumes: `sec` from `./util`；`selectPreset`/`seedInt`/`rootVarsCss` from `./theme`；`pickMove`/`moveTweens`/`beatAccent`/`pickTrans`/`transTweens`/`shardGrid`/`shardOpeningTweens` from `./motion`；`pickEntrance`/`captionUnit` from `./captionsAnim`；`baseCss`/`sceneHtml`/`titleCardHtml`/`watermarkHtml`/`bookHeaderHtml`/`overlayDecorHtml` from `./layout`
- Produces（保持导出，供 `renderVisuals.ts` 使用）:
  - `interface BodyOverlay { title: string; subtitle: string; watermark: string }`
  - `interface BodyImage { src: string }`
  - `interface BodySegment { seqNo; startMs; endMs; subtitle; imageIndex; bookTitle?; bookAuthor?; subtitleEn?; captionBeats? }`（不变）
  - `interface BodyData { size; overlay; images; segments; style?: string; seed?: string }`（**新增 style?/seed?**）
  - `renderIndexHtml(data: BodyData): string`

- [ ] **Step 1: 改写测试为不变量断言**

```ts
// worker/templates/booklist/indexHtml.test.ts —— 整体替换为以下内容
import { describe, it, expect } from 'vitest'
import { renderIndexHtml, type BodyData } from './indexHtml'

const base: BodyData = {
  size: { width: 720, height: 960 },
  overlay: { title: '《活着》', subtitle: '余华 / 著', watermark: '@读书号' },
  images: [{ src: 'media/01.png' }, { src: 'media/02.png' }],
  seed: 'task-seed-1',
  segments: [
    { seqNo: 1, startMs: 0, endMs: 2000, subtitle: '第一句 <字幕>', imageIndex: 0 },
    { seqNo: 2, startMs: 2000, endMs: 4500, subtitle: '第二句', imageIndex: 1 },
  ],
}

// 从产出 HTML 抽出所有 tl.xxx(..., <pos>) 的位置秒数
function tweenPositions(html: string): number[] {
  const out: number[] = []
  const re = /,\s*(\d+(?:\.\d+)?)\)\s*;/g
  let m: RegExpExecArray | null
  const scriptStart = html.indexOf('gsap.timeline')
  const body = html.slice(scriptStart)
  while ((m = re.exec(body))) out.push(parseFloat(m[1]))
  return out
}

describe('renderIndexHtml — 契约', () => {
  const html = renderIndexHtml(base)
  it('声明合成帧与画布尺寸，总时长=最后 endMs', () => {
    expect(html).toContain('data-composition-id="main"')
    expect(html).toContain('data-width="720"')
    expect(html).toContain('data-height="960"')
    expect(html).toContain('data-duration="4.5"')
  })
  it('注册 paused timeline，本地 GSAP，无外网 CDN', () => {
    expect(html).toContain('gsap.timeline({ paused: true })')
    expect(html).toContain('window.__timelines["main"] = tl;')
    expect(html).toContain('<script src="gsap.min.js"></script>')
    expect(html).not.toContain('cdn.jsdelivr.net')
  })
  it('每段一个场景与字幕单元', () => {
    expect(html).toContain('class="scene s1"')
    expect(html).toContain('class="scene s2"')
    expect(html).toContain('class="cap cap1"')
    expect(html).toContain('class="cap cap2"')
  })
  it('转义字幕特殊字符', () => {
    expect(html).toContain('第一句 &lt;字幕&gt;')
    expect(html).not.toContain('第一句 <字幕>')
  })
  it('注入预设 CSS 变量与结构 CSS', () => {
    expect(html).toContain(':root {')
    expect(html).toContain('var(--bg)')
  })
})

describe('renderIndexHtml — seek-safe / 不越界不变量', () => {
  const html = renderIndexHtml(base)
  it('产出不含 function-based 值与 Math.random', () => {
    expect(html).not.toContain('function')
    expect(html).not.toContain('=>')
    expect(html).not.toContain('Math.random')
  })
  it('所有 tween 位置 ∈ [0, data-duration]', () => {
    const dur = 4.5
    for (const p of tweenPositions(html)) {
      expect(p).toBeGreaterThanOrEqual(0)
      expect(p).toBeLessThanOrEqual(dur + 0.001)
    }
  })
})

describe('renderIndexHtml — 确定性与预设', () => {
  it('同输入逐字节一致', () => {
    expect(renderIndexHtml(base)).toBe(renderIndexHtml(base))
  })
  it('style 指定预设时命中对应 token（暗黑高级用 sans 标题字族）', () => {
    const html = renderIndexHtml({ ...base, style: 'dark-premium' })
    expect(html).toContain('--accent: #d4af6a')
  })
})

describe('renderIndexHtml — 首场景开场 + 运镜/转场轮换', () => {
  const html = renderIndexHtml(base)
  it('首场景玻璃碎片开场，t=0 起 stagger 归位', () => {
    expect(html).toContain('class="shatter s1shatter"')
    expect((html.match(/class="shard"/g) ?? []).length).toBeGreaterThanOrEqual(20)
    expect(html).toContain("stagger: { amount: 0.45, from: 'center' } }, 0);")
  })
  it('每段 .photo 都有运镜 tween', () => {
    expect(html).toContain(".s1 .photo'")
    expect(html).toContain(".s2 .photo'")
  })
  it('第二段有进入转场（操作 .s2 与 .s1）', () => {
    // s1→s2 边界在 2 秒，转场类型由分配决定，但必然操作到 .s2
    expect(html).toContain("'.s2'")
  })
})

describe('renderIndexHtml — 向后兼容', () => {
  it('无 seed/style 也能渲染（回退默认预设，不抛）', () => {
    const { seed, ...noSeed } = base
    expect(() => renderIndexHtml(noSeed)).not.toThrow()
  })
  it('无 captionBeats：每段回退整段一条字幕', () => {
    const html = renderIndexHtml(base)
    expect(html).toContain('class="cap cap1"')
    expect(html).toContain('class="cap cap2"')
  })
})

// 书单模式
const booksData: BodyData = {
  size: { width: 720, height: 960 },
  overlay: { title: '', subtitle: '', watermark: '@听页' },
  images: [{ src: 'media/01.png' }, { src: 'media/02.png' }, { src: 'media/03.png' }],
  seed: 'books-seed',
  segments: [
    { seqNo: 1, startMs: 0, endMs: 2000, subtitle: 'a', subtitleEn: 'A', imageIndex: 0, bookTitle: '活下去的理由', bookAuthor: '马特·海格' },
    { seqNo: 2, startMs: 2000, endMs: 4000, subtitle: 'b <x>', subtitleEn: 'B & c', imageIndex: 1, bookTitle: '活下去的理由', bookAuthor: '马特·海格' },
    { seqNo: 3, startMs: 4000, endMs: 6000, subtitle: 'c', subtitleEn: 'C', imageIndex: 2, bookTitle: '当下的力量', bookAuthor: '托利' },
  ],
}

describe('renderIndexHtml — 书单模式', () => {
  const html = renderIndexHtml(booksData)
  it('渲染常驻书名头（含 kicker），连续同书合并', () => {
    expect(html).toContain('class="book-header bh1"')
    expect(html).toContain('bh-kicker')
    expect((html.match(/class="book-header bh1"/g) ?? []).length).toBe(1)
    expect(html).toContain('class="book-header bh2"')
    expect(html).toContain('活下去的理由')
    expect(html).toContain('当下的力量')
  })
  it('渲染中英双语字幕并转义', () => {
    expect(html).toContain('class="cap-en"')
    expect(html).toContain('b &lt;x&gt;')
    expect(html).toContain('B &amp; c')
  })
  it('书单模式不渲染开场标题卡', () => {
    expect(html).not.toContain('class="title-card"')
  })
})

describe('renderIndexHtml — captionBeats 精确节拍', () => {
  it('有节拍时按拍展开为多个 cap 单元，位置取拍的 startMs/endMs', () => {
    const withBeats: BodyData = {
      ...base,
      segments: [
        { seqNo: 1, startMs: 0, endMs: 2000, subtitle: '整段', imageIndex: 0,
          captionBeats: [ { zh: '前拍', startMs: 0, endMs: 1000 }, { zh: '后拍', startMs: 1000, endMs: 2000 } ] },
        { seqNo: 2, startMs: 2000, endMs: 4500, subtitle: '第二段', imageIndex: 1 },
      ],
    }
    const html = renderIndexHtml(withBeats)
    // 段1 两拍 + 段2 一条 = 3 个 cap 单元
    expect(html).toContain('class="cap cap1"')
    expect(html).toContain('class="cap cap2"')
    expect(html).toContain('class="cap cap3"')
    expect(html).toContain('前拍')
    expect(html).toContain('后拍')
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run worker/templates/booklist/indexHtml.test.ts`
Expected: FAIL（旧实现产出与新断言不符 / 尚未支持 style/seed）

- [ ] **Step 3: 重写 indexHtml.ts 为编排器**

```ts
// worker/templates/booklist/indexHtml.ts —— 整体替换
// 编排器：选预设 → 算 offset → 逐段组合运镜/转场/字幕/书名头 → 完整 index.html。
// 所有特效叠在既有 startMs/endMs 之上，不新增时长；契约见 docs/superpowers/specs 2026-07-24。
import { sec } from './util'
import { selectPreset, seedInt, rootVarsCss } from './theme'
import { pickMove, moveTweens, beatAccent, pickTrans, transTweens, shardGrid, shardOpeningTweens } from './motion'
import { pickEntrance, captionUnit } from './captionsAnim'
import { baseCss, sceneHtml, titleCardHtml, watermarkHtml, bookHeaderHtml, overlayDecorHtml } from './layout'

export interface BodyOverlay {
  title: string
  subtitle: string
  watermark: string
}
export interface BodyImage {
  src: string
}
export interface BodySegment {
  seqNo: number
  startMs: number
  endMs: number
  subtitle: string
  imageIndex: number
  bookTitle?: string
  bookAuthor?: string
  subtitleEn?: string
  captionBeats?: { zh: string; en?: string; startMs: number; endMs: number }[]
}
export interface BodyData {
  size: { width: number; height: number }
  overlay: BodyOverlay
  images: BodyImage[]
  segments: BodySegment[]
  /** 框架指定的风格预设 id（framework.overlayTemplate.__style），缺省则由 seed 派生 */
  style?: string
  /** 稳定 seed（genTaskId），驱动预设/招式轮换的确定性 */
  seed?: string
}

export function renderIndexHtml(data: BodyData): string {
  const { width, height } = data.size
  const segs = [...data.segments].sort((a, b) => a.startMs - b.startMs)
  if (segs.length === 0) throw new Error('renderIndexHtml: segments 为空')
  const lastEndSec = sec(Math.max(...segs.map((s) => s.endMs)))

  const seed = data.seed ?? ''
  const preset = selectPreset(data.style, seed)
  const offset = seedInt(seed) % 5 // 轮换相位，5 与招式/转场数互质度足够

  const imgFor = (s: BodySegment, i: number) => data.images[s.imageIndex]?.src ?? data.images[i]?.src ?? ''

  // ---- 场景 HTML ----
  const scenesHtml = segs.map((s, i) => sceneHtml(i + 1, imgFor(s, i))).join('\n')

  // ---- 首场景玻璃碎片开场 + 各边界转场分配 ----
  const openingShatterHtml = shardGrid({
    containerClass: 'shatter s1shatter', imgSrc: imgFor(segs[0], 0), cols: 4, rows: 5, width, height, startScattered: true,
  })
  // 逐边界（i>=1）选转场；shard 转场需要 .tsN 碎片层
  const transForBoundary: string[] = [] // index i → TransId（i>=1 有效）
  const transShardLayers: string[] = []
  segs.forEach((s, i) => {
    if (i === 0) { transForBoundary.push(''); return }
    const tr = pickTrans(s.seqNo, offset)
    transForBoundary.push(tr)
    if (tr === 'shard') {
      transShardLayers.push(shardGrid({
        containerClass: `tshatter ts${i + 1}`, imgSrc: imgFor(segs[i - 1], i - 1), cols: 3, rows: 3, width, height,
      }))
    }
  })

  // ---- 运镜 + 转场 tween ----
  const motionLines: string[] = []
  segs.forEach((s, i) => {
    const n = i + 1
    const isLast = i === segs.length - 1
    motionLines.push(moveTweens(pickMove(s.seqNo, offset), n, s.startMs, s.endMs, isLast))
    if (i === 0) {
      motionLines.push(`  tl.set('.s1', { opacity: 1 }, 0);`)
      motionLines.push(shardOpeningTweens())
    } else {
      motionLines.push(transTweens(transForBoundary[i] as ReturnType<typeof pickTrans>, n, s.startMs))
    }
    // 首拍咬合重音（有节拍才叠；无节拍段落起点=段 startMs）
    motionLines.push(beatAccent(n, s.startMs))
    // 末段结尾定格暗角（时长=段长，不外溢）
    if (isLast) {
      const segLenSec = Math.max(0.1, sec(s.endMs - s.startMs))
      motionLines.push(`  tl.fromTo('.vignette', { opacity: 0 }, { opacity: 0.55, duration: ${segLenSec}, ease: 'sine.in' }, ${sec(s.startMs)});`)
    }
  })

  // ---- 字幕单元（有节拍逐拍，否则整段一条）----
  interface CapSrc { zh: string; en?: string; startMs: number; endMs: number }
  const capSrcs: CapSrc[] = []
  for (const s of segs) {
    const beats = Array.isArray(s.captionBeats) ? s.captionBeats : []
    if (beats.length) for (const b of beats) capSrcs.push({ zh: b.zh, en: b.en, startMs: b.startMs, endMs: b.endMs })
    else capSrcs.push({ zh: s.subtitle, en: s.subtitleEn, startMs: s.startMs, endMs: s.endMs })
  }
  const capHtmlParts: string[] = []
  const capTweenParts: string[] = []
  capSrcs.forEach((u, k) => {
    const unit = captionUnit({ n: k + 1, entrance: pickEntrance(k, offset), zh: u.zh, en: u.en, startMs: u.startMs, endMs: u.endMs })
    capHtmlParts.push(unit.html)
    capTweenParts.push(unit.tweens)
  })

  // ---- 书名头 / 标题卡 ----
  const hasBookMode = segs.some((s) => (s.bookTitle ?? '').trim().length > 0)
  interface BookRun { title: string; author?: string; startIdx: number; endIdx: number }
  const bookRuns: BookRun[] = []
  if (hasBookMode) {
    segs.forEach((s, i) => {
      const title = (s.bookTitle ?? '').trim()
      if (!title) return
      const prev = bookRuns[bookRuns.length - 1]
      if (prev && prev.title === title && prev.endIdx === i - 1) prev.endIdx = i
      else bookRuns.push({ title, author: s.bookAuthor, startIdx: i, endIdx: i })
    })
  }
  const bookHeadersHtml = bookRuns.map((r, ri) => bookHeaderHtml(ri + 1, r.title, r.author)).join('\n')
  const bookHeaderTweens = bookRuns
    .map((r, ri) => {
      const n = ri + 1
      const startSec = sec(segs[r.startIdx].startMs)
      if (r.startIdx === 0) return `  tl.set('.bh${n}', { opacity: 1 }, 0);`
      return (
        `  tl.fromTo('.bh${n}', { opacity: 0 }, { opacity: 1, duration: 0.5, ease: 'sine.inOut' }, ${startSec});\n` +
        `  tl.to('.bh${ri}', { opacity: 0, duration: 0.5, ease: 'sine.inOut' }, ${startSec});`
      )
    })
    .join('\n')

  const titleCard = hasBookMode ? '' : titleCardHtml(data.overlay.title, data.overlay.subtitle)
  const watermark = watermarkHtml(data.overlay.watermark)
  const decor = overlayDecorHtml(preset)
  const scrim = `    <div class="scrim" data-layout-ignore></div>`

  const allTweens = [motionLines.join('\n'), bookHeaderTweens, capTweenParts.join('\n')].filter(Boolean).join('\n')

  return `<!doctype html>
<html lang="zh">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=${width}, height=${height}" />
  <title>booklist body</title>
  <style>
${rootVarsCss(preset)}
${baseCss(preset)}
  </style>
</head>
<body>
  <main id="root" data-composition-id="main" data-start="0" data-duration="${lastEndSec}" data-width="${width}" data-height="${height}">
${scenesHtml}
${openingShatterHtml}
${transShardLayers.join('\n')}
${scrim}
${decor}
${capHtmlParts.join('\n')}
${bookHeadersHtml}
${titleCard}
${watermark}
  </main>
  <script src="gsap.min.js"></script>
  <script>
    window.__timelines = window.__timelines || {};
    var tl = gsap.timeline({ paused: true });
${allTweens}
    window.__timelines["main"] = tl;
  </script>
</body>
</html>
`
}
```

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run worker/templates/booklist/indexHtml.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add worker/templates/booklist/indexHtml.ts worker/templates/booklist/indexHtml.test.ts
git commit -m "feat(booklist): 编排器重写——预设+运镜/转场轮换+字幕入场组合;BodyData 增 style/seed"
```

---

## Task 8: 接线到 renderVisuals + 全量回归

给 `buildBodyData` 增 `genTaskId` 入参并填 `data.style`/`data.seed`；更新调用点。跑全量测试。

**Files:**
- Modify: `worker/src/gen/renderVisuals.ts`（`buildBodyData` 签名 + 函数体 + `renderVisuals()` 调用点）
- Create: `worker/src/gen/renderVisuals.buildBodyData.test.ts`（纯函数测试，不连 DB）

**Interfaces:**
- Consumes: `BodyData`（含新 `style?`/`seed?`）from `../../templates/booklist/indexHtml`
- Produces:
  - `buildBodyData(task: TaskWithFramework, segments: SegmentRow[], genTaskId: string): { data: BodyData; images: {...}[] }` — **新增第三入参 genTaskId**；`data.seed = genTaskId`；`data.style = framework.overlayTemplate.__style`（若为字符串）

- [ ] **Step 1: 写失败测试（纯函数，不连 DB）**

```ts
// worker/src/gen/renderVisuals.buildBodyData.test.ts
import { describe, it, expect } from 'vitest'
import { buildBodyData } from './renderVisuals'

const task = {
  variables: { title: '活着', author: '余华' },
  bodyTimings: [
    { seqNo: 1, startMs: 0, endMs: 2000 },
    { seqNo: 2, startMs: 2000, endMs: 4500 },
  ],
  framework: { overlayTemplate: { title: '《{{title}}》', watermark: '@读书号', __style: 'dark-premium' } },
}
const segments = [
  { seqNo: 1, scriptText: '第一句', imageUrl: '/api/files/gen/x/1.png' },
  { seqNo: 2, scriptText: '第二句', imageUrl: '/api/files/gen/x/2.png' },
]

describe('buildBodyData —— style/seed 注入', () => {
  it('seed 取 genTaskId', () => {
    const { data } = buildBodyData(task as any, segments as any, 'gen-task-123')
    expect(data.seed).toBe('gen-task-123')
  })
  it('style 取 overlayTemplate.__style（字符串时）', () => {
    const { data } = buildBodyData(task as any, segments as any, 'gen-task-123')
    expect(data.style).toBe('dark-premium')
  })
  it('overlayTemplate 无 __style 时 style 为 undefined（走 seed 派生）', () => {
    const t2 = { ...task, framework: { overlayTemplate: { title: 'x', watermark: 'y' } } }
    const { data } = buildBodyData(t2 as any, segments as any, 'g')
    expect(data.style).toBeUndefined()
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run worker/src/gen/renderVisuals.buildBodyData.test.ts`
Expected: FAIL（`buildBodyData` 只接受 2 参 / 未设 seed/style）

- [ ] **Step 3: 改 renderVisuals.ts**

在 `buildBodyData` 签名与函数体：

```ts
// 签名改为（renderVisuals.ts 约 58 行）：
export function buildBodyData(
  task: TaskWithFramework,
  segments: SegmentRow[],
  genTaskId: string,
): { data: BodyData; images: { seqNo: number; abs: string; rel: string }[] } {
```

在函数末尾组装 `data` 处（约 108 行），追加 `style`/`seed`：

```ts
  // 风格预设：框架可在 overlayTemplate.__style 指定；seed 用 genTaskId 保证同任务稳定。
  const ot = (task.framework.overlayTemplate && typeof task.framework.overlayTemplate === 'object'
    ? (task.framework.overlayTemplate as Record<string, unknown>)
    : {})
  const style = typeof ot.__style === 'string' ? ot.__style : undefined

  const data: BodyData = {
    size: { width: WIDTH, height: HEIGHT },
    overlay,
    images: images.map((i) => ({ src: i.rel })),
    segments: bodySegments,
    seed: genTaskId,
    ...(style ? { style } : {}),
  }
  return { data, images }
```

调用点（`renderVisuals()` 内，约 138 行）改为传入 genTaskId：

```ts
  const { data, images } = buildBodyData(task, segments, genTaskId)
```

- [ ] **Step 4: 运行 buildBodyData 测试确认通过**

Run: `npx vitest run worker/src/gen/renderVisuals.buildBodyData.test.ts`
Expected: PASS

- [ ] **Step 5: typecheck + 全量测试（需测试库，见 README「测试」）**

```bash
npx tsc --noEmit -p worker/tsconfig.json
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d postgres
DATABASE_URL="postgresql://mixcut:mixcut@127.0.0.1:55433/mixcut_test" npx vitest run
```
Expected: tsc 无输出；vitest 全绿（含 booklist 5 个新模块测试 + 既有用例）

- [ ] **Step 6: 提交**

```bash
git add worker/src/gen/renderVisuals.ts worker/src/gen/renderVisuals.buildBodyData.test.ts
git commit -m "feat(booklist): renderVisuals 注入 style/seed(genTaskId) 到 BodyData"
```

---

## Task 9: 本地真渲染验收（3 预设截图）+ 文档

对样例任务真跑 `hyperframes render`，逐预设出片抽帧，人工验收美术；重点验证 `char-stagger` 在无头 seek 下是否正常。更新设计文档收尾。

**Files:**
- Create（临时，不入库）: `worker/__renderPreview.ts`（渲染 + 抽帧脚本）
- Modify: `docs/superpowers/specs/2026-07-24-booklist-template-hyperframes-upgrade-design.md`（追加"实测结论"节）
- Possibly modify: `worker/templates/booklist/captionsAnim.ts`（若 char-stagger 失效则从 `ENTRANCES` 移除）

**Interfaces:** 无（集成验证）

- [ ] **Step 1: 准备渲染预览脚本**

```ts
// worker/__renderPreview.ts —— 临时脚本；对给定 genTaskId 用指定 style 渲染并抽 3 帧
// 用法：DATA_DIR=$PWD/data npx tsx worker/__renderPreview.ts <genTaskId> <style>
import { spawnSync } from 'child_process'
import { promises as fs } from 'fs'
import path from 'path'
import { prisma } from '@mixcut/db'
import { buildBodyData } from './src/gen/renderVisuals'
import { renderIndexHtml } from './templates/booklist/indexHtml'
import { DATA_DIR } from './src/paths'

async function main() {
  const [genTaskId, style] = process.argv.slice(2)
  if (!genTaskId) throw new Error('用法: tsx worker/__renderPreview.ts <genTaskId> [style]')
  const task = await prisma.generationTask.findUniqueOrThrow({ where: { id: genTaskId }, include: { framework: true } })
  const segments = await prisma.generatedSegment.findMany({ where: { generationTaskId: genTaskId }, orderBy: { seqNo: 'asc' } })
  const { data, images } = buildBodyData(task as any, segments as any, genTaskId)
  if (style) (data as any).style = style

  const outDir = path.join(DATA_DIR, 'gen', genTaskId, 'preview', style || 'auto')
  const mediaDir = path.join(outDir, 'media')
  await fs.rm(outDir, { recursive: true, force: true })
  await fs.mkdir(mediaDir, { recursive: true })
  const TPL = path.join(__dirname, 'templates', 'booklist')
  await fs.copyFile(path.join(TPL, 'package.json'), path.join(outDir, 'package.json'))
  await fs.copyFile(path.join(TPL, 'gsap.min.js'), path.join(outDir, 'gsap.min.js'))
  for (const img of images) await fs.copyFile(img.abs, path.join(outDir, img.rel))
  await fs.writeFile(path.join(outDir, 'index.html'), renderIndexHtml(data), 'utf8')

  const r = spawnSync('npx', ['--yes', 'hyperframes@0.7.33', 'render', '--quality', 'standard', '--output', 'body.mp4'],
    { cwd: outDir, encoding: 'utf8', stdio: 'inherit', env: { ...process.env, HYPERFRAMES_BROWSER_PATH: process.env.HYPERFRAMES_BROWSER_PATH ?? '/usr/bin/chromium' } })
  if (r.status !== 0) throw new Error('render 失败')
  // 抽 3 帧（开场后、中段、末段）
  const mp4 = path.join(outDir, 'body.mp4')
  for (const [i, t] of [1.0, 3.0, 5.0].entries()) {
    spawnSync('ffmpeg', ['-y', '-ss', String(t), '-i', mp4, '-frames:v', '1', path.join(outDir, `frame${i + 1}.png`)], { stdio: 'ignore' })
  }
  console.log('输出:', outDir)
  await prisma.$disconnect()
}
main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1) })
```

- [ ] **Step 2: 逐预设渲染（用现有本地任务，如缠论 `96622be4-...`）**

```bash
cd worker
for s in warm-literary dark-premium ink-oriental; do
  DATABASE_URL="postgresql://mixcut:mixcut@127.0.0.1:55433/mixcut" REDIS_HOST=127.0.0.1 REDIS_PORT=56379 \
  DATA_DIR="$(cd .. && pwd)/data" npx tsx __renderPreview.ts 96622be4-6b80-46c6-952d-4338c75aa4df $s
done
```
Expected: 三个 `data/gen/<id>/preview/<style>/body.mp4` + 各 3 张 `frameN.png`

- [ ] **Step 3: 人工验收截图（读取 frame PNG，展示给用户）**

用 Read 打开各 `frameN.png` 给用户看。验收点：运镜有变化、转场不单调、字幕清晰（scrim 生效）、书名头 kicker、美术像爆款号。**特别检查 `char-stagger` 那几拍字幕是否正常显示**（无头 seek 下逐字浮现是否成立）。

- [ ] **Step 4: 若 char-stagger 失效则降级**

若截图显示逐字浮现的字幕整拍不显示/错乱，从 `captionsAnim.ts` 的 `ENTRANCES` 移除 `'char-stagger'`：

```ts
export const ENTRANCES: EntranceId[] = ['fade-up', 'mask-reveal', 'slide-in']
```
并重跑 Task 8 Step 5 全量测试确认仍绿，重渲染确认修复。

- [ ] **Step 5: 清理临时脚本 + 更新文档**

```bash
rm worker/__renderPreview.ts
```
在设计文档末尾追加"## 实测结论"：记录三套预设截图评审结果、char-stagger 是否保留、以及任何美术微调。

- [ ] **Step 6: 提交**

```bash
git add docs/superpowers/specs/2026-07-24-booklist-template-hyperframes-upgrade-design.md worker/templates/booklist/captionsAnim.ts
git commit -m "docs(booklist): 三套预设本地渲染验收结论 + char-stagger 兼容性处置"
```

---

## Self-Review

**1. Spec coverage：**
- 运镜库（治木）→ Task 3 ✅
- 转场库 + 碎片 → Task 4 ✅
- 字幕节拍入场（含逐字）→ Task 5 ✅
- 与节拍同步（beatAccent）→ Task 3 + 编排 Task 7 ✅
- 设计 token + 3 套预设 → Task 2 + Task 6（结构 CSS）✅
- 字幕压暗底 / 模糊填充 / 书名头 kicker / 颗粒暗角 → Task 6 ✅
- 预设选择逻辑（style 优先，seed 派生）→ Task 2 + 接线 Task 8 ✅
- 模块拆分（util/theme/motion/captionsAnim/layout/indexHtml）→ Task 1–7 ✅
- 全自动不变（renderVisuals 主流程/渲染调用不动）→ Task 8 仅动 buildBodyData 签名与 data 组装 ✅
- 向后兼容（无 captionBeats / 无 bookTitle）→ Task 7 测试覆盖 ✅
- 本地渲染截图验收 + char-stagger 风险处置 → Task 9 ✅
- 单测不变量（无 function-based、不越 data-duration、确定性）→ Task 7 测试 ✅

**2. Placeholder scan：** 无 TBD/TODO；每个 code step 均含完整代码。char-stagger 降级为 Task 9 的明确条件分支，非占位。

**3. Type consistency：**
- `BodyData` 新增 `style?: string; seed?: string`，Task 7 定义、Task 8 消费一致。
- `pickTrans` 返回 `TransId`，Task 7 编排里 `transTweens(transForBoundary[i] as ReturnType<typeof pickTrans>, ...)` 一致。
- `captionUnit` 返回 `{ html, tweens }`，Task 7 消费一致。
- `moveTweens(move, n, startMs, endMs, isLast)` / `transTweens(trans, n, boundaryMs)` / `beatAccent(n, atMs)` 签名 Task 3/4 定义、Task 7 调用一致。
- `selectPreset(style, seed)` / `seedInt(seed)` / `rootVarsCss(preset)` Task 2 定义、Task 7 使用一致。
- `baseCss(preset)` / `sceneHtml(n, src)` / `bookHeaderHtml(n, title, author?)` / `overlayDecorHtml(preset)` Task 6 定义、Task 7 使用一致。

无缺口。计划就绪。
