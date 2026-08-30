# 双语字幕 · 字体选择 · 画面编辑预览 —— 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让成片支持中英双语字幕、让运营能在后台选字体、并给剪辑参数页加一块所见即所得的画面编辑画布。

**Architecture:** 三块共用一条链路（`TemplateParams` → `paramsWhitelist` → `fromBodyData` → `ass.ts` → ffmpeg）与一套共用 UI 控件（`web/components/admin/paramControls.tsx`，被框架级与任务级两个工作台引用）。双语是「把已有但被丢弃的 `captionBeats[].en` 接回渲染层」；字体是「把 `paramsWhitelist.ts` 注释里记录为死字段的字体真正做活」；画布是一个纯前端 DOM 模拟器，靠「坐标 1:1 + 共享 `fitSizePx` + 同一份字体二进制」三条保真。

**Tech Stack:** TypeScript / Next.js 14 App Router / Prisma 5 / vitest / ffmpeg + libass(ASS 字幕) / fontkit(字体 name 表解析)

**Spec:** `docs/superpowers/specs/2026-08-30-subtitle-font-stage-design.md`

## Global Constraints

- 测试命令统一 `npm test`（根目录 vitest，`include: packages/**/*.test.ts, web/**/*.test.ts, worker/**/*.test.ts`）。单跑一个文件用 `npx vitest run <path>`。
- 真渲染 e2e 默认 skip，靠 `RENDER_E2E=1` 打开，且需要本机有 `ffmpeg`：`RENDER_E2E=1 npx vitest run <path>`。
- **老框架零回归是硬要求**：所有新参数默认值必须让 `buildAss` 的输出与改动前**逐字节相同**。每个涉及 `ass.ts` 的任务都要有一条「默认值下输出不变」的测试。
- 提交信息用中文、`type(scope): 摘要 —— 说明` 格式（对齐 `git log`）。**不写 `Co-Authored-By` 尾注**。
- ASS 的 `Fontname` 认的是**字体内部族名**（name 表 name ID 1），不是文件名。填错会静默回退默认字体、无任何报错。
- ASS 颜色是 `&HAABBGGRR`（BGR 反序、alpha 在前、且 alpha 是**透明度**：00=不透明）。一律走已有的 `toAssColor()`，不要手拼。
- 内联覆盖标签的颜色格式是 `&HBBGGRR&`（少一个 alpha），走已有的 `inlineColor()`。
- 画布上的数值与存进参数的数值必须**完全相同，零换算**。缩放只发生在最外层 `transform: scale()`。
- 内置字体只收 SIL OFL 或明确「免费商用且允许随产品分发」的字体，逐款在 `worker/templates/booklist/fonts/README.md` 登记许可。

---

## 文件结构

**Phase 1 双语字幕**
- 修改 `worker/src/render/ffmpeg/ass.ts` —— `AssCue.en`、`AssStyleOpts` 双语字段、`buildAss` 双语事件与 `capMarginV` 补偿
- 修改 `worker/src/render/ffmpeg/renderBody.ts` —— `RenderBodySegment.captionBeats[].en`、`captionCues` 带出 `en`
- 修改 `worker/src/render/ffmpeg/fromBodyData.ts` —— 透传 `en`、映射双语 `assStyle`
- 修改 `packages/db/src/booklist/templateParams.ts` —— `text` 新增 4 字段 + 默认值 + 解析
- 修改 `packages/db/src/booklist/paramsWhitelist.ts` —— 放行 4 字段
- 修改 `web/components/admin/paramControls.tsx` —— `CaptionStyleRows` 加双语控件
- 修改 `worker/src/gen/generateScript.ts` —— 关双语时跳过 `translateLine`

**Phase 2 字体（内置）**
- 新建 `packages/db/src/booklist/fonts.ts` —— 字体注册表（web/worker 共用的单一事实源）
- 修改 `worker/src/render/ffmpeg/ass.ts` —— Style 行按层取字体
- 修改 `worker/src/render/ffmpeg/fromBodyData.ts` —— 字体 id → 族名映射
- 修改 `worker/src/gen/renderVisuals.ts` —— 组装 per-task 字体目录
- 新增字体文件到 `worker/templates/booklist/fonts/`

**Phase 3 字体（上传）**
- 修改 `packages/db/prisma/schema.prisma` —— `CustomFont` 表
- 新建 `packages/db/src/booklist/fontFamily.ts` —— fontkit 族名解析
- 新建 `web/app/api/admin/fonts/route.ts` —— 列表 / 上传
- 新建 `web/app/api/admin/fonts/[id]/route.ts` —— 删除
- 新建 `web/app/api/fonts/[id]/file/route.ts` —— 字体文件下发（预览用）
- 新建 `web/app/admin/settings/fonts/page.tsx` —— 字体管理页

**Phase 4 画布**
- 移动 `fitSizePx` 到 `packages/db/src/booklist/fitSize.ts`，`ass.ts` 改 re-export
- 新建 `web/components/admin/StageCanvas.tsx` —— 画布组件
- 修改 `web/app/admin/frameworks/[id]/studio/page.tsx` / `web/app/admin/generate/[id]/studio/page.tsx` —— 接入
- 修改 `web/components/admin/paramControls.tsx` —— `TextRows` 补三个 `PosY` 输入框

---

# Phase 1 · 双语字幕

## Task 1: `buildAss` 渲染英文行 + 中文行不位移

**Files:**
- Modify: `worker/src/render/ffmpeg/ass.ts`
- Test: `worker/src/render/ffmpeg/ass.test.ts`

**Interfaces:**
- Consumes: 现有 `toAssColor` / `inlineColor` / `escapeAssText` / `toAssTime`
- Produces:
  - `interface AssCue { text: string; en?: string; startMs: number; endMs: number }`
  - `AssStyleOpts` 新增：`bilingual?: boolean; enScale?: number; enColor?: string; enGapPx?: number; enFontName?: string`
  - `export function bilingualExtraPx(st: AssStyleOpts): number`

- [ ] **Step 1: 写失败测试**

追加到 `worker/src/render/ffmpeg/ass.test.ts`（文件顶部已有一个 `fontName: 'Noto Sans CJK SC'` 的 STYLE 常量，沿用它的写法自建一个本组用的 base style）：

```ts
describe('双语字幕', () => {
  const base = {
    fontName: 'Noto Sans SC', captionColor: '#ffffff', captionPosY: 0.78,
    captionSizePx: 50, titleSizePx: 60, titleColor: '#ffe9c0', watermarkSizePx: 22,
  }
  const cue = { text: '这是一句中文', en: 'This is Chinese', startMs: 0, endMs: 2000 }
  const opts = (style: Record<string, unknown>) =>
    ({ width: 720, height: 1280, captions: [cue], totalMs: 2000, style: { ...base, ...style } })

  it('默认（不开双语）逐字节等于没有 en 字段时的输出', () => {
    const withEn = buildAss(opts({}) as never)
    const withoutEn = buildAss(opts({}) as never)
    expect(withEn).toBe(withoutEn)
    expect(withEn).not.toContain('This is Chinese')
  })

  it('开启后英文跟在中文之后，用 \\N 换行并内联覆盖字号/颜色', () => {
    const ass = buildAss(opts({ bilingual: true, enScale: 0.6, enColor: '#dddddd', enGapPx: 0 }) as never)
    // 50 * 0.6 = 30
    expect(ass).toContain('这是一句中文\\N{\\fs30\\c&HDDDDDD&}This is Chinese')
  })

  it('enGapPx > 0 时插一行等高的硬空格撑出行间距', () => {
    const ass = buildAss(opts({ bilingual: true, enScale: 0.6, enGapPx: 8 }) as never)
    expect(ass).toContain('这是一句中文\\N{\\fs8}\\h\\N{\\fs30')
  })

  it('enFontName 给了就内联换字体', () => {
    const ass = buildAss(opts({ bilingual: true, enFontName: 'Space Grotesk' }) as never)
    expect(ass).toContain('\\fnSpace Grotesk}')
  })

  it('英文为空的拍不产出英文段', () => {
    const ass = buildAss({
      width: 720, height: 1280, totalMs: 2000,
      captions: [{ text: '只有中文', startMs: 0, endMs: 1000 }],
      style: { ...base, bilingual: true },
    } as never)
    expect(ass).toContain('只有中文')
    expect(ass).not.toContain('\\N{\\fs')
  })

  it('★ 开双语时 cap 样式的 MarginV 减去英文块高度，中文行不被顶上去', () => {
    const off = buildAss(opts({}) as never)
    const on = buildAss(opts({ bilingual: true, enScale: 0.6, enGapPx: 8 }) as never)
    const marginV = (ass: string) => Number(/^Style: cap,.*,(\d+),1$/m.exec(ass)![1])
    // 1280 * (1 - 0.78) = 281.6 → 282
    expect(marginV(off)).toBe(282)
    // 英文块高 = round((30 + 8) * 1.2) = 46
    expect(marginV(on)).toBe(282 - 46)
  })

  it('bilingualExtraPx：不开双语恒为 0', () => {
    expect(bilingualExtraPx({ ...base, bilingual: false } as never)).toBe(0)
    expect(bilingualExtraPx({ ...base, bilingual: true, enScale: 0.6, enGapPx: 8 } as never)).toBe(46)
  })

  it('MarginV 不会被减成负数', () => {
    const ass = buildAss(opts({ captionPosY: 0.999, bilingual: true, enScale: 1, enGapPx: 40 }) as never)
    expect(Number(/^Style: cap,.*,(\d+),1$/m.exec(ass)![1])).toBe(0)
  })
})
```

记得在文件顶部的 import 里加上 `bilingualExtraPx`。

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run worker/src/render/ffmpeg/ass.test.ts`
Expected: FAIL —— `bilingualExtraPx is not a function`，以及双语相关断言不通过。

- [ ] **Step 3: 实现**

在 `worker/src/render/ffmpeg/ass.ts`：

3a. `AssCue` 加 `en`：

```ts
export interface AssCue {
  text: string
  /** 双语字幕的英文行。不开双语时忽略。 */
  en?: string
  startMs: number
  endMs: number
}
```

3b. `AssStyleOpts` 末尾追加：

```ts
  /**
   * 双语字幕：中文在上、英文紧贴其下。
   *
   * 英文早就逐拍生成好了（generateScript 的 translateLine → captionBeats[].en），
   * 只是一直没被渲染层消费。默认 false = 老框架逐字节零回归。
   */
  bilingual?: boolean
  /** 英文行字号 = captionSizePx × enScale。缺省 0.6 */
  enScale?: number
  /** 英文行颜色 #rrggbb。缺省 #dddddd */
  enColor?: string
  /** 中英两行之间的额外行间距（px）。0 = 紧贴。缺省 8 */
  enGapPx?: number
  /** 英文行字体族名。不给则跟随正文字体 */
  enFontName?: string
```

3c. 在 `TITLE_BOLD_BORD` 附近加常量与导出函数：

```ts
/**
 * libass 的行距约等于字号的 1.2 倍（无 ASS 标签可直接设行距，只能按经验系数反推）。
 * 用来算双语时英文块占掉的高度，好把中文行顶回原位。
 */
const LINE_H = 1.2

/**
 * 双语时英文块在中文行**下方**占掉的高度（px）。
 *
 * 为什么必须算它：正文字幕是 an2（底边锚点），captionPosY 定的是中文行基线的位置，
 * MarginV = 画面高 - 基线位置。加了英文行后整块变高，同一个 captionPosY 下
 * **中文行会被英文行顶上去**——运营开关一次双语就会发现"字幕位置自己变了"。
 * 把这块高度从 MarginV 里减掉，中文行位置就与关闭双语时一致，英文往下长。
 */
export function bilingualExtraPx(st: AssStyleOpts): number {
  if (!st.bilingual) return 0
  const enPx = Math.round(st.captionSizePx * (st.enScale ?? 0.6))
  const gap = Math.max(0, Math.round(st.enGapPx ?? 8))
  return Math.round((enPx + gap) * LINE_H)
}
```

3d. `buildAss` 里把 `capMarginV` 改成：

```ts
  const capMarginV = Math.max(0, Math.round(o.height * (1 - st.captionPosY)) - bilingualExtraPx(st))
```

3e. 在 `buildAss` 里，`const fad = ...` 那一段之后、`for (const c of o.captions) line(1, c, 'cap', fad)` 之前，插入英文行拼接函数，并把循环改成用它：

```ts
  // 中英合并成**一条** Dialogue 事件：时序天然一致，\fad 也自动同时作用于两行，
  // 不需要在两个独立事件之间做对齐。
  const enPx = Math.round(st.captionSizePx * (st.enScale ?? 0.6))
  const enGap = Math.max(0, Math.round(st.enGapPx ?? 8))
  const enTags = `{\\fs${enPx}\\c${inlineColor(st.enColor ?? '#dddddd')}${st.enFontName ? `\\fn${st.enFontName}` : ''}}`
  // 行间距：ASS 没有行距标签（\fsp 是字距）。插一行只含硬空格 \h 的小字号行来撑高度。
  const gapLine = enGap > 0 ? `{\\fs${enGap}}\\h\\N` : ''
  const withEn = (c: AssCue): AssCue => {
    if (!st.bilingual) return c
    const en = escapeAssText(c.en ?? '')
    if (!en) return c
    // 中文段先转义，英文段单独转义后拼在标签之后——整串一起转义会把覆盖标签的
    // 大括号也转掉，标签会原样显示在画面上。
    return { ...c, text: `${escapeAssText(c.text)}\\N${gapLine}${enTags}${en}`, en: undefined }
  }
  for (const c of o.captions) line(1, withEn(c), 'cap', fad)
```

**注意**：`line()` 内部会再调一次 `escapeAssText`。所以 `withEn` 返回的已转义字符串会被二次转义。必须让 `line()` 对已转义内容幂等 —— 最省事且明确的做法是给 `line` 加一个「原文已转义」的开关：

```ts
  const line = (layer: number, c: AssCue, style: string, tag = '', preEscaped = false) => {
    const text = preEscaped ? c.text : escapeAssText(c.text)
    ...
  }
```

调用改成：

```ts
  for (const c of o.captions) {
    const merged = withEn(c)
    line(1, merged, 'cap', fad, merged !== c)
  }
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run worker/src/render/ffmpeg/ass.test.ts`
Expected: PASS，且**文件里原有的全部测试也照样通过**（零回归的证据）。

- [ ] **Step 5: 跑全量测试**

Run: `npm test`
Expected: 全绿。若 `fromBodyData.test.ts` 因 `AssCue` 类型变化报错，那是类型可选字段，不应该报错；真报错说明改动超出预期，停下来查。

- [ ] **Step 6: 提交**

```bash
git add worker/src/render/ffmpeg/ass.ts worker/src/render/ffmpeg/ass.test.ts
git commit -m "feat(ass): 双语字幕渲染 —— 中英合并一条事件 + 中文行不位移补偿"
```

---

## Task 2: 参数层放行双语字段

**Files:**
- Modify: `packages/db/src/booklist/templateParams.ts:116-139`（类型）、`:157-166`（默认值）、`:282-` (解析)
- Modify: `packages/db/src/booklist/paramsWhitelist.ts`（`text` 分区，约 :127-155）
- Test: `packages/db/src/booklist/paramsWhitelist.test.ts`（若不存在则新建）

**Interfaces:**
- Produces: `TemplateParams.text` 新增 `bilingual: boolean; enScale: number; enColor: string; enGapPx: number`

- [ ] **Step 1: 写失败测试**

追加到 `packages/db/src/booklist/paramsWhitelist.test.ts`：

```ts
describe('双语字幕字段', () => {
  it('放行并原样保留合法值', () => {
    const out = sanitizeParamsOverride({
      text: { bilingual: true, enScale: 0.55, enColor: '#dddddd', enGapPx: 10 },
    })
    expect(out!.text).toEqual({ bilingual: true, enScale: 0.55, enColor: '#dddddd', enGapPx: 10 })
  })

  it('enScale 越界夹到 [0.3, 1.0]', () => {
    expect((sanitizeParamsOverride({ text: { enScale: 9 } })!.text as never as { enScale: number }).enScale).toBe(1)
    expect((sanitizeParamsOverride({ text: { enScale: 0 } })!.text as never as { enScale: number }).enScale).toBe(0.3)
  })

  it('enGapPx 越界夹到 [0, 40]，并取整', () => {
    expect((sanitizeParamsOverride({ text: { enGapPx: 99.7 } })!.text as never as { enGapPx: number }).enGapPx).toBe(40)
  })

  it('enColor 非 #rrggbb 直接丢弃', () => {
    expect(sanitizeParamsOverride({ text: { enColor: 'red' } })).toBeNull()
  })

  it('bilingual 非布尔直接丢弃', () => {
    expect(sanitizeParamsOverride({ text: { bilingual: 'yes' } })).toBeNull()
  })
})
```

追加到 `packages/db/src/booklist/templateParams.test.ts`（若不存在则新建同名文件）：

```ts
it('双语字段缺省时给出默认值', () => {
  const p = parseTemplateParams({})
  expect(p.text!.bilingual).toBe(false)
  expect(p.text!.enScale).toBe(0.6)
  expect(p.text!.enColor).toBe('#dddddd')
  expect(p.text!.enGapPx).toBe(8)
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run packages/db/src/booklist/paramsWhitelist.test.ts packages/db/src/booklist/templateParams.test.ts`
Expected: FAIL

- [ ] **Step 3: 实现**

3a. `templateParams.ts` 的 `text?: { ... }` 类型块末尾（`openTitleColor: string` 之后）追加：

```ts
    /** 双语字幕总开关。false = 完全不渲染英文（老框架零回归） */
    bilingual: boolean
    /** 英文行字号 = captionSizePx × enScale */
    enScale: number
    /** 英文行颜色 #rrggbb */
    enColor: string
    /** 中英两行的额外行间距（px） */
    enGapPx: number
```

3b. `DEFAULT_PARAMS.text` 末尾追加：

```ts
    bilingual: false, enScale: 0.6, enColor: '#dddddd', enGapPx: 8,
```

3c. `parseTemplateParams` 的 `text: (() => { ... })()` 返回对象里追加：

```ts
        bilingual: bool(t.bilingual, DT.bilingual),
        enScale: num(t.enScale, DT.enScale),
        enColor: str(t.enColor, DT.enColor),
        enGapPx: Math.max(0, num(t.enGapPx, DT.enGapPx)),
```

3d. `paramsWhitelist.ts` 的 `if (text) { ... }` 块里，`for (const k of ['bookTitleColor', ...])` 之后追加：

```ts
    // 双语字幕。渲染层真读（ass.ts 的 bilingual/enScale/enColor/enGapPx），不是死字段。
    if (typeof text.bilingual === 'boolean') t.bilingual = text.bilingual
    const es = clampNum(text.enScale, 0.3, 1)
    if (es !== undefined) t.enScale = es
    const eg = clampNum(text.enGapPx, 0, 40)
    if (eg !== undefined) t.enGapPx = Math.round(eg)
    if (typeof text.enColor === 'string' && HEX.test(text.enColor)) t.enColor = text.enColor
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npm test`
Expected: 全绿

- [ ] **Step 5: 提交**

```bash
git add packages/db/src/booklist/
git commit -m "feat(params): 双语字幕参数入白名单 —— bilingual/enScale/enColor/enGapPx"
```

---

## Task 3: 把 `en` 从 BodyData 透传到 ASS

**Files:**
- Modify: `worker/src/render/ffmpeg/renderBody.ts:19`（类型）、`:72-85`（`captionCues`）
- Modify: `worker/src/render/ffmpeg/fromBodyData.ts:91`（透传）、`:122-145`（`assStyle` 映射）
- Test: `worker/src/render/ffmpeg/renderBody.test.ts`、`worker/src/render/ffmpeg/fromBodyData.test.ts`

**Interfaces:**
- Consumes: Task 1 的 `AssCue.en` / `AssStyleOpts.bilingual` 等；Task 2 的 `TemplateParams.text.bilingual` 等
- Produces: `RenderBodySegment.captionBeats?: { zh: string; en?: string; startMs: number; endMs: number }[]`

- [ ] **Step 1: 写失败测试**

追加到 `worker/src/render/ffmpeg/renderBody.test.ts`：

```ts
it('captionCues 把每拍的 en 一起带出来', () => {
  const cues = captionCues([{
    imageAbs: '/x.jpg', startMs: 0, endMs: 2000,
    captionBeats: [
      { zh: '第一拍', en: 'Beat one', startMs: 0, endMs: 1000 },
      { zh: '第二拍', startMs: 1000, endMs: 2000 },
    ],
  }])
  expect(cues).toEqual([
    { text: '第一拍', en: 'Beat one', startMs: 0, endMs: 1000 },
    { text: '第二拍', startMs: 1000, endMs: 2000 },
  ])
})
```

追加到 `worker/src/render/ffmpeg/fromBodyData.test.ts`（该文件已有 `expect(o.assStyle.fontName).toBe('Noto Sans SC')` 这类断言，沿用它构造 BodyData 的方式）：

```ts
it('双语参数映射进 assStyle', () => {
  const o = fromBodyData(bodyDataWith({
    __templateParams: { text: { bilingual: true, enScale: 0.5, enColor: '#cccccc', enGapPx: 12 } },
  }), io)
  expect(o.assStyle.bilingual).toBe(true)
  expect(o.assStyle.enScale).toBe(0.5)
  expect(o.assStyle.enColor).toBe('#cccccc')
  expect(o.assStyle.enGapPx).toBe(12)
})

it('没配双语时 assStyle 里不出现 bilingual（老调用零回归）', () => {
  const o = fromBodyData(bodyDataWith({}), io)
  expect(o.assStyle.bilingual).toBeFalsy()
})

it('captionBeats 的 en 透传进 bodySegments', () => {
  const o = fromBodyData(bodyDataWithBeats([
    { zh: '中文', en: 'English', startMs: 0, endMs: 900 },
  ]), io)
  expect(o.bodySegments[0].captionBeats![0].en).toBe('English')
})
```

> 构造 `bodyDataWith` / `bodyDataWithBeats` 时**沿用该测试文件里已有的 fixture 写法**，不要另起一套。若文件里已有等价 helper，直接用。

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run worker/src/render/ffmpeg/renderBody.test.ts worker/src/render/ffmpeg/fromBodyData.test.ts`
Expected: FAIL

- [ ] **Step 3: 实现**

3a. `renderBody.ts:19` 改为：

```ts
  captionBeats?: { zh: string; en?: string; startMs: number; endMs: number }[]
```

3b. `renderBody.ts` 的 `captionCues` 里，`out.push(...)` 改为：

```ts
      out.push({ text: b.zh, ...(b.en?.trim() ? { en: b.en } : {}), startMs: b.startMs, endMs: b.endMs })
```

同时把上面那行 fallback 也补一下（整段回退时没有英文，保持不变即可）：

```ts
    const beats = s.captionBeats?.length
      ? s.captionBeats
      : [{ zh: s.subtitle ?? '', startMs: s.startMs, endMs: s.endMs }]
```

3c. `fromBodyData.ts:90-92` 改为：

```ts
    ...(s.captionBeats?.length
      ? { captionBeats: s.captionBeats.map((b) => ({ zh: b.zh, ...(b.en ? { en: b.en } : {}), startMs: b.startMs, endMs: b.endMs })) }
      : {}),
```

3d. `fromBodyData.ts` 的 `assStyle: { ... }` 里，`...(tx?.boldBordPx !== undefined ? ... : {})` 之后追加：

```ts
      // 双语字幕。默认关：没配过的老框架 assStyle 里连 bilingual 这个键都不出现，
      // buildAss 的输出逐字节不变。
      ...(tx?.bilingual ? {
        bilingual: true,
        ...(tx.enScale !== undefined ? { enScale: tx.enScale } : {}),
        ...(tx.enColor !== undefined ? { enColor: tx.enColor } : {}),
        ...(tx.enGapPx !== undefined ? { enGapPx: tx.enGapPx } : {}),
      } : {}),
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npm test`
Expected: 全绿

- [ ] **Step 5: 提交**

```bash
git add worker/src/render/ffmpeg/
git commit -m "fix(render): 字幕英文行不再被丢弃 —— captionBeats.en 接进 ASS"
```

---

## Task 4: 后台加双语控件

**Files:**
- Modify: `web/components/admin/paramControls.tsx` —— `TextParams` 类型 + `CaptionStyleRows`
- Modify: `web/app/admin/frameworks/[id]/studio/page.tsx` —— `CaptionStyleRows` 的调用签名变了

**Interfaces:**
- Consumes: Task 2 的参数字段
- Produces: `CaptionStyleRows` 新签名（见下）；`TextParams` 新增 `bilingual/enScale/enColor/enGapPx`

- [ ] **Step 1: 改类型与控件**

`paramControls.tsx` 的 `TextParams` 追加：

```ts
  bilingual: boolean
  enScale: number
  enColor: string
  enGapPx: number
```

`CaptionStyleRows` 改为同时接收文字层参数（双语属于字幕样式，运营应该在一处看到）：

```ts
/**
 * 字幕样式：颜色、竖直位置、双语。
 *
 * 双语的英文文本早就逐拍生成好了（translateLine），这里只是控制**渲不渲、怎么渲**。
 * 关掉双语的框架，以后生成时会跳过翻译调用（见 generateScript）。
 */
export function CaptionStyleRows(props: {
  color: string; posY: number
  onColor: (v: string) => void; onPosY: (v: number) => void
  text: TextParams | null; onText: (v: TextParams) => void
  disabled?: boolean
}) {
  const t = props.text
  const set = (patch: Partial<TextParams>) => t && props.onText({ ...t, ...patch })
  return (
    <>
      <label className="flex items-center gap-3 py-1">
        <span className="w-40 shrink-0 text-xs text-ink3">正文字幕颜色</span>
        <input type="color" className="h-8 w-14 rounded border border-line" disabled={props.disabled}
          value={props.color} onChange={(e) => props.onColor(e.target.value)} />
        <span className="num text-xs text-ink3">{props.color}</span>
      </label>
      <NumRow label="正文字幕竖直位置" value={props.posY} disabled={props.disabled}
        min={0} max={1} step={0.01} hint="0 = 顶端，1 = 底端" onChange={props.onPosY} />
      {t && (
        <>
          <label className="flex items-center gap-3 py-1">
            <span className="w-40 shrink-0 text-xs text-ink3">中英双语字幕</span>
            <input type="checkbox" checked={t.bilingual} disabled={props.disabled}
              onChange={(e) => set({ bilingual: e.target.checked })} />
            <span className="text-xs text-ink3">中文在上、英文紧贴其下。关掉后以后生成会跳过翻译（省调用）</span>
          </label>
          {t.bilingual && (
            <>
              <NumRow label="英文字号倍数" value={t.enScale} disabled={props.disabled}
                min={0.3} max={1} step={0.05} unit="×" hint={`相对正文，当前约 ${Math.round(t.captionSizePx * t.enScale)}px`}
                onChange={(v) => set({ enScale: v })} />
              <ColorRow label="英文行颜色" value={t.enColor} disabled={props.disabled}
                onChange={(v) => set({ enColor: v })} />
              <NumRow label="中英行间距" value={t.enGapPx} disabled={props.disabled}
                min={0} max={40} step={1} unit="px" hint="0 = 紧贴" onChange={(v) => set({ enGapPx: v })} />
            </>
          )}
        </>
      )}
      <p className="text-xs text-ink3">字号在「文字层」分区调（正文字号锚点）。</p>
    </>
  )
}
```

> 注意：把原来那句「字体固定用自带的 Noto Sans SC」删掉 —— Phase 2 之后这句话就不成立了，留着会误导。
> `ColorRow` 目前定义在文件下方、`CaptionStyleRows` 之上，函数声明会提升，可以直接用。

- [ ] **Step 2: 更新调用点**

`web/app/admin/frameworks/[id]/studio/page.tsx` 的「字幕样式」Section 改为：

```tsx
      <Section title="字幕样式" what="字幕样式"
        patch={() => ({ body: { subtitleColor: capColor, subtitlePosY: capPosY }, ...(text ? { text } : {}) })}>
        <CaptionStyleRows color={capColor} posY={capPosY} onColor={setCapColor} onPosY={setCapPosY}
          text={text} onText={setText} />
      </Section>
```

同样处理 `web/app/admin/generate/[id]/studio/page.tsx` 里的 `CaptionStyleRows` 调用（先 `grep -n CaptionStyleRows web/app/admin/generate/\[id\]/studio/page.tsx` 定位，照搬同样的改法，用该文件自己的 state 变量名）。

- [ ] **Step 3: 类型检查 + 测试**

Run: `npx tsc --noEmit -p web/tsconfig.json && npm test`
Expected: 无类型错误，测试全绿

- [ ] **Step 4: 提交**

```bash
git add web/components/admin/paramControls.tsx web/app/admin/frameworks web/app/admin/generate
git commit -m "feat(admin): 字幕样式加中英双语开关 —— 英文字号/颜色/行距可调"
```

---

## Task 5: 双语真渲染 e2e（墨迹断言）

**Files:**
- Modify: `worker/src/render/ffmpeg/ass.e2e.test.ts`

**Interfaces:**
- Consumes: Task 1 的 `buildAss` 双语输出；已有的 `ink()` 墨迹断言 helper 与 `FONTS_DIR` / `DEFAULT_FONT_NAME`

**为什么这条不能省**：单测只能证明 ASS 字符串拼对了。字体解析失败时英文行可能整行空白、或中文变豆腐块，字符串断言照样全绿。只有真烧进画面数像素才验得出来。

- [ ] **Step 1: 写测试**

追加到 `worker/src/render/ffmpeg/ass.e2e.test.ts`（沿用文件里已有的 `ff()` / 墨迹占比 helper 与 `W`/`H` 常量；下面的 `inkIn(...)` 请替换成该文件里实际的 helper 名）：

```ts
d('双语字幕真渲', () => {
  const STYLE_BI = {
    ...STYLE, captionPosY: 0.78, captionSizePx: 48,
    bilingual: true, enScale: 0.6, enColor: '#dddddd', enGapPx: 8,
  }
  const CUE = [{ text: '这是一句中文字幕', en: 'This is one line of English', startMs: 200, endMs: 1800 }]

  it('中文行与英文行都真的有墨，且英文在中文下方', () => {
    const ass = buildAss({ width: W, height: H, captions: CUE, totalMs: 2000, style: STYLE_BI } as never)
    // 中文基线 y ≈ H * 0.78；中文带在其上，英文带在其下
    const zhBand = `${W}:70:0:${Math.round(H * 0.78) - 60}`
    const enBand = `${W}:60:0:${Math.round(H * 0.78) + 6}`
    // 用 inkIn(assContent, atSec, cropExpr) 渲一帧并数亮像素占比（见本文件已有 helper）
    expect(inkIn(ass, 1.0, zhBand)).toBeGreaterThan(0.002)
    expect(inkIn(ass, 1.0, enBand)).toBeGreaterThan(0.002)
  })

  it('★ 中文行位置与关闭双语时一致（容差 6px 内）', () => {
    const off = buildAss({ width: W, height: H, captions: CUE, totalMs: 2000, style: { ...STYLE, captionPosY: 0.78, captionSizePx: 48 } } as never)
    const on = buildAss({ width: W, height: H, captions: CUE, totalMs: 2000, style: STYLE_BI } as never)
    // 只量中文那条横带：双语开关不该让它移动
    const zhBand = `${W}:70:0:${Math.round(H * 0.78) - 60}`
    const a = inkIn(off, 1.0, zhBand)
    const b = inkIn(on, 1.0, zhBand)
    expect(Math.abs(a - b) / Math.max(a, b)).toBeLessThan(0.15)
  })

  it('关闭双语时英文带上完全没有墨', () => {
    const ass = buildAss({ width: W, height: H, captions: CUE, totalMs: 2000, style: { ...STYLE, captionPosY: 0.78, captionSizePx: 48 } } as never)
    const enBand = `${W}:60:0:${Math.round(H * 0.78) + 6}`
    expect(inkIn(ass, 1.0, enBand)).toBe(0)
  })
})
```

> 若文件里现有的 helper 签名与 `inkIn(ass, atSec, crop)` 不同，**照它的签名改测试，不要改 helper** —— 其它 e2e 用例依赖它。

- [ ] **Step 2: 跑 e2e**

Run: `RENDER_E2E=1 npx vitest run worker/src/render/ffmpeg/ass.e2e.test.ts`
Expected: PASS。若「英文带有墨」这条失败，先看 ffmpeg 的 `fontselect:` 日志确认字体解析没退到别的字体；再看 `\h` 撑行的做法在本机 libass 版本下是否生效 —— 若确实不生效，按 spec 的回退方案把英文行拆成独立 Dialogue + `\pos` 定位（时序仍取自同一 beat）。

- [ ] **Step 3: 跑默认 skip 路径确认没破坏 CI**

Run: `npx vitest run worker/src/render/ffmpeg/ass.e2e.test.ts`
Expected: 全部 skipped（没有 `RENDER_E2E=1` 时）

- [ ] **Step 4: 提交**

```bash
git add worker/src/render/ffmpeg/ass.e2e.test.ts
git commit -m "test(ass): 双语字幕真渲墨迹断言 —— 含中文行不位移校验"
```

---

## Task 6: 关掉双语就不再花钱翻译

**Files:**
- Modify: `worker/src/gen/generateScript.ts:713-728`
- Test: `worker/src/gen/generateScript.singleBook.test.ts`（或该目录下已有的 generateScript 测试文件）

**Interfaces:**
- Consumes: Task 2 的 `TemplateParams.text.bilingual`；`generateScript` 里已有的 `tp`（`tp.script?.captionMaxChars` 就是从它取的）

- [ ] **Step 1: 写失败测试**

```ts
it('框架关了双语时不调用 translateLine', async () => {
  const spy = vi.fn()
  // 沿用本文件已有的 mockLlmComplete 计数方式，统计 buildTranslatePrompt 产生的调用
  await runGenerateScriptWith({ text: { bilingual: false } })
  expect(translateCallCount()).toBe(0)
})

it('框架开了双语时每拍都翻译', async () => {
  await runGenerateScriptWith({ text: { bilingual: true } })
  expect(translateCallCount()).toBeGreaterThan(0)
})
```

> `runGenerateScriptWith` / `translateCallCount` 请按该测试文件已有的 fixture 与 mock 方式实现（文件里已有 `mockLlmComplete` 的用法，见 `generateScript.singleBook.test.ts:196` 附近关于「translateLine 走 mock 短路」的注释）。

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run worker/src/gen/`
Expected: 「关了双语不调用」这条 FAIL

- [ ] **Step 3: 实现**

`generateScript.ts` 的 beats 循环改为：

```ts
  // 双语关掉时不翻译：translateLine 是**逐拍一次 LLM 调用**，
  // 而英文只有在 text.bilingual 开启时才会被渲染层消费（见 ass.ts）。
  // 关掉双语还翻译就是纯浪费。
  const wantEn = tp.text?.bilingual === true
  ...
    const beats: { zh: string; en: string }[] = []
    for (const zh of phrases) beats.push({ zh, en: wantEn ? await translateLine(zh) : '' })
```

`subtitleEn` 那行保持不变（`beats.map(b => b.en).join(' ')` 在全空时得到一串空格，需要收紧）：

```ts
      subtitleEn: wantEn ? beats.map((b) => b.en).join(' ') : '',
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npm test`
Expected: 全绿

- [ ] **Step 5: 提交**

```bash
git add worker/src/gen/generateScript.ts worker/src/gen/
git commit -m "perf(gen): 框架关闭双语时跳过逐拍翻译 —— 省掉一批 LLM 调用"
```

---

## Task 7: Phase 1 收尾 —— 文档

**Files:**
- Modify: `README.md`

- [ ] **Step 1: 更新 README**

在「功能概览 → 管理员端」的剪辑参数相关描述里补一句（若没有该条目就加在「剪映工程导入」之后）：

```markdown
- 剪辑参数：框架级与单条级两个工作台共用同一套控件，可调节奏、转场、运镜、字幕样式、文字层、配乐、文案口径。**中英双语字幕**可按框架开关，开启后中文在上、英文紧贴其下，英文字号倍数 / 颜色 / 行间距独立可调；关闭的框架在生成时会跳过翻译调用。
```

- [ ] **Step 2: 提交**

```bash
git add README.md
git commit -m "docs(readme): 补充中英双语字幕说明"
```

---

# Phase 2 · 字体选择（内置）

> **⚠️ 开工前必须做的事**：内置字体清单要跟用户确认。每款 5~15MB 会永久进仓库。
> 候选：思源黑体 Bold（SIL OFL，解决「书名不够粗只能靠同色描边硬撑」）、思源宋体 Regular（SIL OFL）、
> 霞鹜文楷（SIL OFL）、站酷快乐体（免费商用）。**清单没确认前不要执行 Task 9。**

## Task 8: 字体注册表

**Files:**
- Create: `packages/db/src/booklist/fonts.ts`
- Create: `packages/db/src/booklist/fonts.test.ts`
- Modify: `packages/db/src/index.ts`（导出）

**Interfaces:**
- Produces:
  ```ts
  export type FontEntry = { id: string; family: string; file: string; label: string }
  export const BUILTIN_FONTS: readonly FontEntry[]
  export const DEFAULT_FONT_ID = 'noto-sc'
  export function findBuiltinFont(id: string | undefined): FontEntry | undefined
  ```

- [ ] **Step 1: 写失败测试**

`packages/db/src/booklist/fonts.test.ts`：

```ts
import { describe, it, expect } from 'vitest'
import { BUILTIN_FONTS, DEFAULT_FONT_ID, findBuiltinFont } from './fonts'

describe('字体注册表', () => {
  it('默认字体在表里，且族名是 Noto Sans SC', () => {
    const d = findBuiltinFont(DEFAULT_FONT_ID)
    expect(d).toBeDefined()
    expect(d!.family).toBe('Noto Sans SC')
    expect(d!.file).toBe('NotoSansSC-Regular.otf')
  })

  it('id 唯一', () => {
    const ids = BUILTIN_FONTS.map((f) => f.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('族名唯一 —— 两款字体同族名会让 ASS 的 Fontname 无法区分', () => {
    const fams = BUILTIN_FONTS.map((f) => f.family)
    expect(new Set(fams).size).toBe(fams.length)
  })

  it('认不出的 id 返回 undefined，不抛错', () => {
    expect(findBuiltinFont('nope')).toBeUndefined()
    expect(findBuiltinFont(undefined)).toBeUndefined()
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run packages/db/src/booklist/fonts.test.ts`
Expected: FAIL —— 找不到模块

- [ ] **Step 3: 实现**

`packages/db/src/booklist/fonts.ts`：

```ts
// 字体注册表：web 与 worker 的**单一事实源**。
//
// worker 需要 file（拷进 fontsdir）与 family（写进 ASS 的 Fontname）；
// web 需要 family（画布上的 CSS font-family）与 id（下发文件的路由参数）。
// 两边各维护一份必然会漂，所以放在 packages/db 里共用。
//
// ★ family 必须是**字体内部族名**（name 表的 name ID 1），不是文件名。
// ASS 的 Fontname 认族名；填文件名会静默回退到默认字体、没有任何报错
// （见 worker/src/render/ffmpeg/fonts.ts 里已有的踩坑记录）。
// 加新字体时用 `fc-scan --format "%{family}\n" <file>` 或 fontkit 确认族名，不要凭文件名猜。

export type FontEntry = {
  /** 稳定标识，存进 TemplateParams。改了它等于把已配置的框架的字体设置清空 */
  id: string
  /** 字体内部族名，写进 ASS 的 Fontname / CSS 的 font-family */
  family: string
  /** worker/templates/booklist/fonts/ 下的文件名 */
  file: string
  /** 后台下拉里的中文显示名 */
  label: string
}

export const BUILTIN_FONTS: readonly FontEntry[] = [
  { id: 'noto-sc', family: 'Noto Sans SC', file: 'NotoSansSC-Regular.otf', label: '思源黑体 Regular' },
] as const

/** 一个字体都没配时用它。与 worker 的 DEFAULT_FONT_NAME 指同一款。 */
export const DEFAULT_FONT_ID = 'noto-sc'

export function findBuiltinFont(id: string | undefined): FontEntry | undefined {
  if (!id) return undefined
  return BUILTIN_FONTS.find((f) => f.id === id)
}
```

在 `packages/db/src/index.ts` 里加导出（照该文件已有的 re-export 写法）：

```ts
export * from './booklist/fonts'
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npm test`
Expected: 全绿

- [ ] **Step 5: 提交**

```bash
git add packages/db/src/booklist/fonts.ts packages/db/src/booklist/fonts.test.ts packages/db/src/index.ts
git commit -m "feat(fonts): 字体注册表 —— web/worker 共用的单一事实源"
```

---

## Task 9: 把内置字体文件放进仓库

**Files:**
- Create: `worker/templates/booklist/fonts/<各字体文件>`
- Modify: `worker/templates/booklist/fonts/README.md`
- Modify: `packages/db/src/booklist/fonts.ts`（补 `BUILTIN_FONTS` 条目）
- Modify: `packages/db/src/booklist/fonts.test.ts`

**⚠️ 前置**：字体清单必须已经跟用户确认过。没确认就停下来问。

- [ ] **Step 1: 下载字体并确认内部族名**

对每一款字体，下载后**必须**先确认族名，不要凭文件名猜：

```bash
# 方式一（有 fontconfig）
fc-scan --format "%{family}\n" worker/templates/booklist/fonts/<file>
# 方式二（无 fontconfig，用已装的 fontkit）
node -e "console.log(require('fontkit').openSync(process.argv[1]).familyName)" worker/templates/booklist/fonts/<file>
```

- [ ] **Step 2: 写测试锁住每一款的族名**

在 `fonts.test.ts` 追加（每款一条，用 Step 1 实测到的族名）：

```ts
it('每款内置字体的文件都真实存在，且族名与实测一致', () => {
  const dir = path.resolve(__dirname, '../../../../worker/templates/booklist/fonts')
  for (const f of BUILTIN_FONTS) {
    expect(fs.existsSync(path.join(dir, f.file)), `缺文件：${f.file}`).toBe(true)
    expect(fontkit.openSync(path.join(dir, f.file)).familyName, `族名对不上：${f.file}`).toBe(f.family)
  }
})
```

（需要 `import fs from 'fs'`、`import path from 'path'`、`import fontkit from 'fontkit'`。fontkit 在 Task 13 才装 —— 若此时还没装，先执行 Task 13 的 Step「装 fontkit」，或本条改成只断言文件存在、族名断言留到 Task 13 之后补。**更简单的做法：把 Task 13 的装依赖步骤提到这里**。）

- [ ] **Step 3: 跑测试确认失败 → 补齐 BUILTIN_FONTS → 再跑通过**

Run: `npx vitest run packages/db/src/booklist/fonts.test.ts`

- [ ] **Step 4: 登记许可**

`worker/templates/booklist/fonts/README.md` 里每款一行：字体名 / 文件名 / 内部族名 / 许可 / 来源 URL。

- [ ] **Step 5: 提交**

```bash
git add worker/templates/booklist/fonts/ packages/db/src/booklist/fonts.ts packages/db/src/booklist/fonts.test.ts
git commit -m "feat(fonts): 内置可商用中文字体入库 —— 含许可登记"
```

---

## Task 10: ASS 按层取字体

**Files:**
- Modify: `worker/src/render/ffmpeg/ass.ts`
- Test: `worker/src/render/ffmpeg/ass.test.ts`

**Interfaces:**
- Produces: `AssStyleOpts` 新增 `titleFontName?: string`（`fontName` 继续作为正文/水印字体；`enFontName` 已在 Task 1 加过）

- [ ] **Step 1: 写失败测试**

```ts
describe('分层字体', () => {
  const base = {
    fontName: 'Noto Sans SC', captionColor: '#ffffff', captionPosY: 0.78,
    captionSizePx: 50, titleSizePx: 60, titleColor: '#ffe9c0', watermarkSizePx: 22,
    openTitleSizePx: 40, flashTitleSizePx: 58,
  }
  const build = (style: Record<string, unknown>) =>
    buildAss({ width: 720, height: 1280, captions: [], totalMs: 1000, style: { ...base, ...style } } as never)

  it('不给 titleFontName 时所有 Style 行都用 fontName（老调用零回归）', () => {
    const ass = build({})
    for (const name of ['cap', 'title', 'ot', 'wm', 'ft', 'fa']) {
      expect(ass).toContain(`Style: ${name},Noto Sans SC,`)
    }
  })

  it('给了 titleFontName 时 title/ot/ft/fa 换字体，cap/wm 不变', () => {
    const ass = build({ titleFontName: '思源宋体' })
    expect(ass).toContain('Style: cap,Noto Sans SC,')
    expect(ass).toContain('Style: wm,Noto Sans SC,')
    expect(ass).toContain('Style: title,思源宋体,')
    expect(ass).toContain('Style: ot,思源宋体,')
    expect(ass).toContain('Style: ft,思源宋体,')
    expect(ass).toContain('Style: fa,思源宋体,')
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run worker/src/render/ffmpeg/ass.test.ts`
Expected: 第二条 FAIL

- [ ] **Step 3: 实现**

`AssStyleOpts` 追加：

```ts
  /**
   * 标题类字体族名：常驻书名大标题(title) + 快闪书名/作者(ft/fa) + 开场标题(ot)。
   * 不给则跟随 fontName。正文字幕(cap)与水印(wm)恒用 fontName。
   *
   * 只做「正文 / 标题」两档：ass.ts 里本来就是两套 Style，与现有结构对齐；
   * 四层各给一个下拉框对运营是负担，真有需求再拆。
   */
  titleFontName?: string
```

`buildAss` 的 header 构造里，先取：

```ts
  const titleFont = st.titleFontName || st.fontName
```

然后把 `title` / `ot` / `ft` / `fa` 四行的 `${st.fontName}` 换成 `${titleFont}`。`cap` 与 `wm` 保持 `${st.fontName}`。

- [ ] **Step 4: 跑测试确认通过**

Run: `npm test`
Expected: 全绿（含 `ass.test.ts` 里原有的全部用例）

- [ ] **Step 5: 提交**

```bash
git add worker/src/render/ffmpeg/ass.ts worker/src/render/ffmpeg/ass.test.ts
git commit -m "feat(ass): 标题类字体可与正文分开设置"
```

---

## Task 11: 字体参数入白名单 + 映射进 assStyle

**Files:**
- Modify: `packages/db/src/booklist/templateParams.ts`
- Modify: `packages/db/src/booklist/paramsWhitelist.ts`
- Modify: `worker/src/render/ffmpeg/fromBodyData.ts`
- Test: `packages/db/src/booklist/paramsWhitelist.test.ts`、`worker/src/render/ffmpeg/fromBodyData.test.ts`

**Interfaces:**
- Consumes: Task 8 的 `findBuiltinFont` / `DEFAULT_FONT_ID`；Task 10 的 `titleFontName`
- Produces: `TemplateParams.text` 新增 `captionFontId: string; titleFontId: string; enFontId: string`

- [ ] **Step 1: 写失败测试**

`paramsWhitelist.test.ts`：

```ts
describe('字体字段', () => {
  it('放行三个字体 id', () => {
    const out = sanitizeParamsOverride({
      text: { captionFontId: 'noto-sc', titleFontId: 'noto-sc', enFontId: '' },
    })
    expect(out!.text).toEqual({ captionFontId: 'noto-sc', titleFontId: 'noto-sc', enFontId: '' })
  })

  it('id 过长直接丢弃（防止把整段 JSON 塞进来）', () => {
    expect(sanitizeParamsOverride({ text: { captionFontId: 'x'.repeat(200) } })).toBeNull()
  })

  it('不校验 id 是否存在 —— 自定义字体的 id 是 cuid，白名单层不查库', () => {
    const out = sanitizeParamsOverride({ text: { captionFontId: 'clxxxxxxxxxxxxxxxxxxxxxx' } })
    expect((out!.text as { captionFontId: string }).captionFontId).toBe('clxxxxxxxxxxxxxxxxxxxxxx')
  })
})
```

`fromBodyData.test.ts`：

```ts
it('字体 id 映射成族名写进 assStyle', () => {
  const o = fromBodyData(bodyDataWith({
    __templateParams: { text: { captionFontId: 'noto-sc', titleFontId: 'noto-sc' } },
  }), io)
  expect(o.assStyle.fontName).toBe('Noto Sans SC')
  expect(o.assStyle.titleFontName).toBe('Noto Sans SC')
})

it('认不出的字体 id 回退默认字体，不报错', () => {
  const o = fromBodyData(bodyDataWith({ __templateParams: { text: { captionFontId: 'ghost' } } }), io)
  expect(o.assStyle.fontName).toBe('Noto Sans SC')
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run packages/db/src/booklist/paramsWhitelist.test.ts worker/src/render/ffmpeg/fromBodyData.test.ts`

- [ ] **Step 3: 实现**

3a. `templateParams.ts` 的 `text` 类型追加，并在 `DEFAULT_PARAMS.text` 与 `parseTemplateParams` 里同步：

```ts
    /** 正文字幕字体 id（见 packages/db/src/booklist/fonts.ts）。'' = 默认字体 */
    captionFontId: string
    /** 标题类字体 id（书名大标题 + 快闪卡 + 开场标题）。'' = 跟随正文 */
    titleFontId: string
    /** 双语英文行字体 id。'' = 跟随正文 */
    enFontId: string
```

默认值：`captionFontId: '', titleFontId: '', enFontId: '',`
解析：`captionFontId: str(t.captionFontId, DT.captionFontId), ...`（三个都一样）

> ⚠️ `str()` 的实现是「空串走默认值」（`typeof v === 'string' && v.trim()`），默认值本身就是 `''`，所以行为正确。

3b. `paramsWhitelist.ts` 的 `text` 块追加：

```ts
    // 字体 id。**不校验是否存在** —— 内置 id 在 BUILTIN_FONTS 里，自定义 id 是
    // CustomFont 的 cuid，白名单层查库不合适（它是纯函数）。认不出的 id 由
    // fromBodyData 回退到默认字体，不会渲染失败。
    for (const k of ['captionFontId', 'titleFontId', 'enFontId'] as const) {
      const v = text[k]
      if (typeof v === 'string' && v.length <= 64) t[k] = v
    }
```

3c. `fromBodyData.ts` 需要把 id 解析成族名。由于自定义字体在库里、而 `fromBodyData` 是纯函数（不碰 IO），**族名解析必须由调用方喂进来**：给 `FromBodyDataIo` 加一张表：

```ts
  /**
   * 字体 id → 族名。由调用方（renderVisuals）合并内置表与库里的自定义字体后传入。
   * fromBodyData 是纯函数，不能自己查库。
   */
  fontFamilies?: Record<string, string>
```

在 `assStyle` 构造前：

```ts
  // 字体 id → 族名。认不出就回退默认字体：宁可字体没换，也不能渲染失败。
  const fam = (id: string | undefined): string | undefined => {
    if (!id) return undefined
    return io.fontFamilies?.[id] ?? findBuiltinFont(id)?.family
  }
  const captionFont = fam(tx?.captionFontId) ?? DEFAULT_FONT_NAME
```

`assStyle` 里：

```ts
      fontName: captionFont,
      ...(fam(tx?.titleFontId) ? { titleFontName: fam(tx?.titleFontId) } : {}),
```

双语块里补：

```ts
        ...(fam(tx?.enFontId) ? { enFontName: fam(tx?.enFontId) } : {}),
```

顶部 import 加 `import { findBuiltinFont } from '@mixcut/db'`（照该文件已有的 import 风格；若 worker 里习惯从相对路径引，跟着来）。

- [ ] **Step 4: 跑测试确认通过**

Run: `npm test`
Expected: 全绿

- [ ] **Step 5: 提交**

```bash
git add packages/db/src/booklist/ worker/src/render/ffmpeg/
git commit -m "feat(params): 字体 id 入白名单并映射成 ASS 族名"
```

---

## Task 12: 渲染时组装 per-task 字体目录

**Files:**
- Modify: `worker/src/gen/renderVisuals.ts:243-266` 附近
- Modify: `worker/src/render/ffmpeg/fromBodyData.ts:176`（`fontsDir` 改为可注入）
- Test: `worker/src/render/ffmpeg/fromBodyData.test.ts`

**Interfaces:**
- Consumes: Task 11 的 `io.fontFamilies`
- Produces: `FromBodyDataIo.fontsDir?: string`（缺省仍为 `FONTS_DIR`）

**为什么要 per-task 目录**：`subtitlesFilter` 只接受**一个** `fontsdir`，而一条片子可能同时用到内置字体和自定义字体（后者落在 `data/fonts/`，不在仓库里）。把本条用到的 1~3 个字体文件拷进任务目录，`fontsdir` 指它——干净、确定性、不污染仓库内置目录。

- [ ] **Step 1: 写失败测试**

```ts
it('fontsDir 可注入，缺省仍是仓库内置目录', () => {
  expect(fromBodyData(bodyDataWith({}), io).fontsDir).toBe(FONTS_DIR)
  expect(fromBodyData(bodyDataWith({}), { ...io, fontsDir: '/tmp/x/fonts' }).fontsDir).toBe('/tmp/x/fonts')
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run worker/src/render/ffmpeg/fromBodyData.test.ts`

- [ ] **Step 3: 实现**

3a. `FromBodyDataIo` 加 `fontsDir?: string`，`fromBodyData` 的返回值里 `fontsDir: io.fontsDir ?? FONTS_DIR`。

3b. `renderVisuals.ts`：在已有的 `await fs.cp(path.join(TEMPLATE_DIR, 'fonts'), path.join(hfDir, 'fonts'), ...)` 之后（该拷贝原本是给 HyperFrames 分支用的，现在正好复用成 per-task 字体目录），补上自定义字体：

```ts
// 本条真正用到的字体：内置的已经随 TEMPLATE_DIR/fonts 整目录拷过来了，
// 这里只需把库里的自定义字体文件补进去，并产出 id → 族名表喂给 fromBodyData。
// （fromBodyData 是纯函数不能查库，见它的 io.fontFamilies 注释。）
const taskFontsDir = path.join(hfDir, 'fonts')
const fontFamilies: Record<string, string> = {}
for (const f of BUILTIN_FONTS) fontFamilies[f.id] = f.family

const usedIds = [tp.text?.captionFontId, tp.text?.titleFontId, tp.text?.enFontId]
  .filter((x): x is string => !!x && !findBuiltinFont(x))
if (usedIds.length) {
  const customs = await prisma.customFont.findMany({ where: { id: { in: usedIds } } })
  for (const c of customs) {
    await fs.copyFile(path.join(DATA_DIR, 'fonts', c.fileName), path.join(taskFontsDir, c.fileName))
    fontFamilies[c.id] = c.family
  }
}
```

> `prisma.customFont` 要等 Task 13 建表之后才存在。**执行顺序**：先做 Task 13 建表迁移，再回来做这一步；或先只写 `fontFamilies` 的内置部分、把自定义部分留到 Task 13 的收尾步骤。计划里按前者执行 —— 见下方 Step 3.5。

- [ ] **Step 3.5: 如果 `CustomFont` 表还不存在**

先跳到 **Task 13** 完成建表，再回来。本步骤不允许写 `// TODO` 占位。

3c. 把 `taskFontsDir` 与 `fontFamilies` 传进 `fromBodyData` 的 io（找到 `renderBodyWithFfmpeg` / `fromBodyData` 的实际调用点，把两个字段加进去）。

- [ ] **Step 4: 跑测试确认通过**

Run: `npm test`
Expected: 全绿

- [ ] **Step 5: 提交**

```bash
git add worker/src/
git commit -m "feat(render): per-task 字体目录 —— 内置与自定义字体一起喂给 fontsdir"
```

---

# Phase 3 · 字体上传

## Task 13: `CustomFont` 表 + fontkit 族名解析

**Files:**
- Modify: `packages/db/prisma/schema.prisma`
- Create: `packages/db/prisma/migrations/<timestamp>_custom_font/migration.sql`（由 `prisma migrate dev` 生成）
- Create: `packages/db/src/booklist/fontFamily.ts`
- Create: `packages/db/src/booklist/fontFamily.test.ts`
- Modify: `packages/db/package.json`（加 `fontkit` 依赖）

**Interfaces:**
- Produces: `export function readFontFamily(fileAbs: string): string` —— 解析失败抛 `Error`

- [ ] **Step 1: 装依赖**

```bash
npm i fontkit -w packages/db
npm i -D @types/fontkit -w packages/db
```

- [ ] **Step 2: 写失败测试**

`packages/db/src/booklist/fontFamily.test.ts`：

```ts
import { describe, it, expect } from 'vitest'
import path from 'path'
import { readFontFamily } from './fontFamily'

const NOTO = path.resolve(__dirname, '../../../../worker/templates/booklist/fonts/NotoSansSC-Regular.otf')

describe('readFontFamily', () => {
  it('读出字体内部族名', () => {
    expect(readFontFamily(NOTO)).toBe('Noto Sans SC')
  })

  it('不是字体文件时抛错 —— 必须拒收，族名错了会静默回退默认字体、毫无报错', () => {
    expect(() => readFontFamily(__filename)).toThrow()
  })

  it('文件不存在时抛错', () => {
    expect(() => readFontFamily('/nope/nope.ttf')).toThrow()
  })
})
```

- [ ] **Step 3: 跑测试确认失败**

Run: `npx vitest run packages/db/src/booklist/fontFamily.test.ts`

- [ ] **Step 4: 实现**

`packages/db/src/booklist/fontFamily.ts`：

```ts
// 从 ttf/otf 里读出**字体内部族名**（name 表 name ID 1）。
//
// 为什么必须解析而不能让运营手填：ASS 的 Fontname 认族名不认文件名，
// 填错的后果是**静默回退到默认字体**——成片看起来"字体没换"，但渲染日志毫无异常，
// 排查成本极高。所以上传时就解析出来，解析不出直接拒收。

import fontkit from 'fontkit'

export function readFontFamily(fileAbs: string): string {
  const font = fontkit.openSync(fileAbs)
  // 字体集合（.ttc）返回 FontCollection，没有 familyName；本项目不收集合文件
  const family = (font as { familyName?: string }).familyName
  if (!family || !family.trim()) throw new Error('无法解析字体族名（可能不是有效的 ttf/otf，或是字体集合文件）')
  return family.trim()
}
```

`schema.prisma` 追加：

```prisma
/// 运营上传的自定义字体。内置字体见 packages/db/src/booklist/fonts.ts（不入库）。
model CustomFont {
  id        String   @id @default(cuid())
  /// 后台下拉里的显示名，运营填
  label     String
  /// 字体内部族名（name 表 name ID 1），上传时用 fontkit 解析得到。写进 ASS 的 Fontname
  family    String
  /// data/fonts/ 下的文件名
  fileName  String
  createdAt DateTime @default(now())
}
```

生成迁移：

```bash
npx prisma migrate dev --name custom_font --schema packages/db/prisma/schema.prisma
```

在 `packages/db/src/index.ts` 加 `export * from './booklist/fontFamily'`。

- [ ] **Step 5: 跑测试确认通过**

Run: `npm test`
Expected: 全绿

- [ ] **Step 6: 提交**

```bash
git add packages/db/
git commit -m "feat(fonts): CustomFont 表 + fontkit 族名解析"
```

---

## Task 14: 字体上传 / 列表 / 删除 接口

**Files:**
- Create: `web/app/api/admin/fonts/route.ts`
- Create: `web/app/api/admin/fonts/[id]/route.ts`
- Create: `web/app/api/admin/fonts/route.test.ts`

**Interfaces:**
- Consumes: Task 13 的 `readFontFamily`、`prisma.customFont`
- Produces:
  - `GET /api/admin/fonts` → `{ builtin: FontEntry[]; custom: { id, label, family, createdAt }[] }`
  - `POST /api/admin/fonts`（multipart: `file`, `label`）→ `{ id, label, family }`
  - `DELETE /api/admin/fonts/[id]` → `{ ok: true }`

- [ ] **Step 1: 写失败测试**

照 `web/app/api/frameworks/[id]/params/route.test.ts` 已有的 mock 方式（`requireRole` / `prisma` 都要 mock）写：

```ts
describe('POST /api/admin/fonts', () => {
  it('非 ttf/otf 拒收', async () => {
    const res = await POST(reqWithFile('x.png', Buffer.from('nope')))
    expect(res.status).toBe(400)
  })

  it('超过 30MB 拒收', async () => {
    const res = await POST(reqWithFile('big.ttf', Buffer.alloc(31 * 1024 * 1024)))
    expect(res.status).toBe(400)
  })

  it('族名解析不出时拒收，且不落盘', async () => {
    const res = await POST(reqWithFile('fake.ttf', Buffer.from('not a font')))
    expect(res.status).toBe(400)
    expect(writtenFiles()).toEqual([])
  })

  it('合法字体落盘并入库，族名来自解析而非文件名', async () => {
    const res = await POST(reqWithFile('随便起的名.otf', realNotoBuffer(), { label: '思源黑体' }))
    expect(res.status).toBe(200)
    expect((await res.json()).family).toBe('Noto Sans SC')
  })
})

describe('DELETE /api/admin/fonts/[id]', () => {
  it('删不存在的 id 也返回 ok（幂等，与 BGM 删除同口径）', async () => {
    const res = await DELETE(new Request('http://x'), { params: { id: 'ghost' } })
    expect(res.status).toBe(200)
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run web/app/api/admin/fonts/route.test.ts`

- [ ] **Step 3: 实现**

`web/app/api/admin/fonts/route.ts`：

```ts
import { NextResponse } from 'next/server'
import fs from 'fs/promises'
import path from 'path'
import { randomUUID } from 'crypto'
import { prisma, readFontFamily, BUILTIN_FONTS } from '@mixcut/db'
import { requireRole, HttpError } from '@/lib/auth'
import { handler } from '@/lib/api'

const FONTS_DATA_DIR = path.join(process.env.DATA_DIR ?? 'data', 'fonts')
const MAX_BYTES = 30 * 1024 * 1024

export const GET = handler(async () => {
  await requireRole('operator')
  const custom = await prisma.customFont.findMany({
    orderBy: { createdAt: 'desc' },
    select: { id: true, label: true, family: true, createdAt: true },
  })
  return NextResponse.json({ builtin: BUILTIN_FONTS, custom })
})

export const POST = handler(async (req) => {
  await requireRole('operator')
  const fd = await req.formData()
  const file = fd.get('file')
  if (!(file instanceof File)) throw new HttpError(400, '没有收到字体文件')
  const ext = path.extname(file.name).toLowerCase()
  if (ext !== '.ttf' && ext !== '.otf') throw new HttpError(400, '只支持 .ttf / .otf')
  if (file.size > MAX_BYTES) throw new HttpError(400, '字体文件不能超过 30MB')

  const buf = Buffer.from(await file.arrayBuffer())
  await fs.mkdir(FONTS_DATA_DIR, { recursive: true })
  // 先写到临时文件再解析：解析失败要一并删掉，不能留孤儿文件。
  const fileName = `${randomUUID()}${ext}`
  const abs = path.join(FONTS_DATA_DIR, fileName)
  await fs.writeFile(abs, buf)

  let family: string
  try {
    family = readFontFamily(abs)
  } catch (e) {
    await fs.rm(abs, { force: true })
    // 族名解析不出就必须拒收：填错族名的后果是成片静默回退默认字体、毫无报错。
    throw new HttpError(400, `字体解析失败：${(e as Error).message}`)
  }

  const label = String(fd.get('label') ?? '').trim() || family
  const row = await prisma.customFont.create({
    data: { label: label.slice(0, 40), family, fileName },
    select: { id: true, label: true, family: true },
  })
  return NextResponse.json(row)
})
```

`web/app/api/admin/fonts/[id]/route.ts`：

```ts
import { NextResponse } from 'next/server'
import fs from 'fs/promises'
import path from 'path'
import { prisma } from '@mixcut/db'
import { requireRole } from '@/lib/auth'
import { handler } from '@/lib/api'

const FONTS_DATA_DIR = path.join(process.env.DATA_DIR ?? 'data', 'fonts')

/** 幂等删除：删不存在的 id 也返回 ok（与 BGM 删除同口径，见 fc4f4aa） */
export const DELETE = handler(async (_req, { params }) => {
  await requireRole('operator')
  const row = await prisma.customFont.findUnique({ where: { id: params.id } })
  if (row) {
    await fs.rm(path.join(FONTS_DATA_DIR, row.fileName), { force: true })
    await prisma.customFont.delete({ where: { id: row.id } })
  }
  return NextResponse.json({ ok: true })
})
```

> `DATA_DIR` 的取法请对齐仓库里已有的写法（`grep -rn "DATA_DIR" web/lib worker/src | head`），不要另立一套。

- [ ] **Step 4: 跑测试确认通过**

Run: `npm test`
Expected: 全绿

- [ ] **Step 5: 提交**

```bash
git add web/app/api/admin/fonts/
git commit -m "feat(admin): 自定义字体上传/列表/删除接口 —— 族名解析失败即拒收"
```

---

## Task 15: 字体文件下发（画布预览用）

**Files:**
- Create: `web/app/api/fonts/[id]/file/route.ts`
- Create: `web/app/api/fonts/[id]/file/route.test.ts`

**Interfaces:**
- Produces: `GET /api/fonts/[id]/file` → 字体二进制 + `ETag` + `Cache-Control: public, max-age=31536000, immutable`

**为什么不复制一份到 `web/public/fonts/`**：`web/Dockerfile` 是 `COPY . .`，整个仓库都在 web 镜像里。内置字体读 `worker/templates/booklist/fonts/` 即可，自定义字体读 `data/fonts/`。字体文件全仓库只存一份。

- [ ] **Step 1: 写失败测试**

```ts
it('内置字体返回文件与 immutable 缓存头', async () => {
  const res = await GET(new Request('http://x'), { params: { id: 'noto-sc' } })
  expect(res.status).toBe(200)
  expect(res.headers.get('cache-control')).toContain('immutable')
  expect(res.headers.get('etag')).toBeTruthy()
})

it('带匹配的 If-None-Match 返回 304', async () => {
  const first = await GET(new Request('http://x'), { params: { id: 'noto-sc' } })
  const etag = first.headers.get('etag')!
  const res = await GET(new Request('http://x', { headers: { 'if-none-match': etag } }), { params: { id: 'noto-sc' } })
  expect(res.status).toBe(304)
})

it('认不出的 id 返回 404', async () => {
  const res = await GET(new Request('http://x'), { params: { id: 'ghost' } })
  expect(res.status).toBe(404)
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run web/app/api/fonts/`

- [ ] **Step 3: 实现**

```ts
import { NextResponse } from 'next/server'
import fs from 'fs/promises'
import path from 'path'
import { createHash } from 'crypto'
import { prisma, findBuiltinFont } from '@mixcut/db'
import { requireRole } from '@/lib/auth'
import { handler } from '@/lib/api'

const BUILTIN_DIR = path.resolve(process.cwd(), 'worker/templates/booklist/fonts')
const CUSTOM_DIR = path.join(process.env.DATA_DIR ?? 'data', 'fonts')

/**
 * 字体文件下发：给剪辑参数页的画布预览用。
 * 预览拿到的**就是** worker 渲染时 fontsdir 里的那个二进制 —— 这是画布保真的前提之一。
 */
export const GET = handler(async (req, { params }) => {
  await requireRole('operator')
  const b = findBuiltinFont(params.id)
  let abs: string
  if (b) {
    abs = path.join(BUILTIN_DIR, b.file)
  } else {
    const row = await prisma.customFont.findUnique({ where: { id: params.id } })
    if (!row) return new NextResponse(null, { status: 404 })
    abs = path.join(CUSTOM_DIR, row.fileName)
  }
  const buf = await fs.readFile(abs).catch(() => null)
  if (!buf) return new NextResponse(null, { status: 404 })

  const etag = `"${createHash('sha1').update(buf).digest('hex')}"`
  if (req.headers.get('if-none-match') === etag) return new NextResponse(null, { status: 304, headers: { etag } })

  return new NextResponse(buf, {
    headers: {
      'content-type': 'font/otf',
      etag,
      // 字体文件内容不会原地变（自定义字体每次上传是新 id + 新文件名），可以放心 immutable
      'cache-control': 'public, max-age=31536000, immutable',
    },
  })
})
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npm test`
Expected: 全绿

- [ ] **Step 5: 提交**

```bash
git add web/app/api/fonts/
git commit -m "feat(fonts): 字体文件下发接口 —— 画布预览与成片渲染共用同一份二进制"
```

---

## Task 16: 后台字体管理页 + 剪辑参数里的字体下拉

**Files:**
- Create: `web/app/admin/settings/fonts/page.tsx`
- Modify: `web/components/admin/paramControls.tsx` —— `TextRows` 加三个字体下拉
- Modify: `web/app/admin/settings/page.tsx`（或后台导航所在文件）—— 加入口链接

**Interfaces:**
- Consumes: Task 14 的接口、Task 11 的 `captionFontId/titleFontId/enFontId`
- Produces: `export function FontSelect(props: { label: string; value: string; onChange: (v: string) => void; fonts: FontOption[]; allowInherit?: boolean; disabled?: boolean })`；`export type FontOption = { id: string; label: string; family: string; builtin: boolean }`

- [ ] **Step 1: 加 `FontSelect` 控件**

在 `paramControls.tsx` 里（放在 `ColorRow` 旁边）：

```tsx
export type FontOption = { id: string; label: string; family: string; builtin: boolean }

/** 字体下拉。allowInherit 时给一个「跟随正文」的空值项。 */
export function FontSelect(props: {
  label: string; value: string; onChange: (v: string) => void
  fonts: FontOption[]; allowInherit?: boolean; disabled?: boolean
}) {
  return (
    <label className="flex items-center gap-3 py-1">
      <span className="w-40 shrink-0 text-xs text-ink3">{props.label}</span>
      <select className="field w-56 text-sm" disabled={props.disabled}
        value={props.value} onChange={(e) => props.onChange(e.target.value)}>
        <option value="">{props.allowInherit ? '跟随正文字体' : '默认（思源黑体）'}</option>
        {props.fonts.map((f) => (
          <option key={f.id} value={f.id}>{f.builtin ? f.label : `${f.label}（上传）`}</option>
        ))}
      </select>
    </label>
  )
}
```

在 `TextRows` 的 props 里加 `fonts: FontOption[]`，并在最前面插三行：

```tsx
      <FontSelect label="正文字幕字体" value={t.captionFontId} fonts={props.fonts} disabled={props.disabled}
        onChange={(v) => set({ captionFontId: v })} />
      <FontSelect label="标题类字体" value={t.titleFontId} fonts={props.fonts} allowInherit disabled={props.disabled}
        onChange={(v) => set({ titleFontId: v })} />
      {t.bilingual && (
        <FontSelect label="英文行字体" value={t.enFontId} fonts={props.fonts} allowInherit disabled={props.disabled}
          onChange={(v) => set({ enFontId: v })} />
      )}
```

两个 studio 页在 `load()` 里同时拉 `/api/admin/fonts`，把 `builtin.map(f => ({...f, builtin: true}))` 与 `custom.map(f => ({...f, builtin: false}))` 拼成 `fonts` state 传下去。

- [ ] **Step 2: 写字体管理页**

`web/app/admin/settings/fonts/page.tsx`，照 `web/app/admin/bgm/page.tsx` 的列表 + 上传 + 删除的写法（同一套 `PageHeader` / `card` / `btn-*` / `pill-*` 样式类）实现：
- 表格列：显示名 / 内部族名 / 来源（内置 / 上传）/ 上传时间 / 操作（内置的不给删）
- 上传区：文件选择（`accept=".ttf,.otf"`）+ 显示名输入框 + 上传按钮，pending 态挡连点
- 页面顶部一行提示：**上传字体的版权由上传者自负；内置字体均为 SIL OFL 或明确免费商用**

- [ ] **Step 3: 加导航入口**

在后台「系统设置」页（`web/app/admin/settings/page.tsx`）加一个跳 `/admin/settings/fonts` 的链接卡片，文案「字体管理 · 内置字体清单与自定义字体上传」。

- [ ] **Step 4: 类型检查 + 测试**

Run: `npx tsc --noEmit -p web/tsconfig.json && npm test`
Expected: 无错、全绿

- [ ] **Step 5: 更新 README**

在「管理员端」功能列表加一条：

```markdown
- 字体管理：内置若干可商用中文字体，运营也可上传自有 .ttf/.otf（上传时自动解析字体内部族名，解析失败即拒收）。剪辑参数里正文字幕与标题类可分别选字体，双语的英文行可另选字体。
```

- [ ] **Step 6: 提交**

```bash
git add web/ README.md
git commit -m "feat(admin): 字体管理页 + 剪辑参数字体下拉 —— 正文/标题/英文行分别可选"
```

---

## Task 17: 字体切换真生效的 e2e

**Files:**
- Modify: `worker/src/render/ffmpeg/ass.e2e.test.ts`

**为什么要这条**：字体族名填错时 libass 静默回退默认字体，成片"看起来正常"、日志无异常。只有解析 ffmpeg 的 `fontselect:` 日志才验得出来。该文件 `:150` 已有同款做法（`/fontselect: \(Noto Sans SC,[^)]*\) -> [^\n]*NotoSansSC/`），照抄。

- [ ] **Step 1: 写测试**

```ts
d('分层字体真解析', () => {
  it('titleFontName 给的族名真的被 libass 解析到对应文件', () => {
    // 用第二款内置字体（BUILTIN_FONTS[1]）；只有一款内置字体时跳过
    const alt = BUILTIN_FONTS[1]
    if (!alt) return
    const ass = buildAss({
      width: W, height: H, totalMs: 1000, captions: [],
      bookTitles: [{ text: '《活着》', startMs: 0, endMs: 900 }],
      style: { ...STYLE, titleFontName: alt.family },
    } as never)
    const { out } = renderWithAss(ass) // 本文件已有的渲染 helper，会带上 -v verbose
    expect(out).toMatch(new RegExp(`fontselect: \\(${alt.family},[^)]*\\) -> [^\\n]*${alt.file.replace(/\\.[^.]+$/, '')}`))
  })
})
```

> `renderWithAss` 请替换成该文件里实际的渲染 helper 名；若现有 helper 没有开 verbose 日志，参考 `:150` 那条用例是怎么拿到日志的，照它的方式来。

- [ ] **Step 2: 跑 e2e**

Run: `RENDER_E2E=1 npx vitest run worker/src/render/ffmpeg/ass.e2e.test.ts`
Expected: PASS

- [ ] **Step 3: 提交**

```bash
git add worker/src/render/ffmpeg/ass.e2e.test.ts
git commit -m "test(fonts): 字体切换真解析验收 —— 解析 fontselect 日志"
```

---

# Phase 4 · 画面编辑 + 预览

## Task 18: `fitSizePx` 抽到共享包

**Files:**
- Create: `packages/db/src/booklist/fitSize.ts`
- Create: `packages/db/src/booklist/fitSize.test.ts`
- Modify: `worker/src/render/ffmpeg/ass.ts`（改为 re-export）
- Modify: `packages/db/src/index.ts`

**Interfaces:**
- Produces: `export function fitSizePx(text: string, basePx: number, widthPx: number, marginPx = 40): number`

**为什么要抽**：画布必须复刻「长书名按可用宽度缩排」的行为，否则《我们生活在巨大的差距里》在画布上和成片上是两个字号。复制一份代码必然漂 —— 抽成共享纯函数是唯一靠谱的做法。

- [ ] **Step 1: 移动函数，函数体逐字节不变**

把 `worker/src/render/ffmpeg/ass.ts` 里的 `fitSizePx` 及其上方的完整注释块**原样**剪切到 `packages/db/src/booklist/fitSize.ts`。`ass.ts` 里改为：

```ts
// fitSizePx 抽到 packages/db 供后台画布共用 —— 画布要复刻同样的长标题缩排行为，
// 复制一份代码必然会漂。
export { fitSizePx } from '@mixcut/db'
```

> 若 worker 里从 `@mixcut/db` 引入的 import 路径写法与此不同，跟着该文件已有的写法。

`packages/db/src/index.ts` 加 `export * from './booklist/fitSize'`。

- [ ] **Step 2: 把现有测试也搬过去（或保留原处）**

`ass.test.ts` 里现有的 `fitSizePx` 用例**原样保留**，因为 `ass.ts` 仍 re-export 它 —— 这就是「零回归」的证据。另在 `fitSize.test.ts` 加一条锚定测试：

```ts
it('按最长的那一行量，不是整串 —— 换行符与 ASS 的 \\N 都要切', () => {
  // 线上事故：「《被讨厌的勇气》\N岸见一郎、古贺史健」被当成一行 18 字，
  // 100px 被缩到 35px，比正文字幕还小。
  expect(fitSizePx('《九字书名啊》\\N作者', 100, 720)).toBe(fitSizePx('《九字书名啊》', 100, 720))
})
```

- [ ] **Step 3: 跑测试**

Run: `npm test`
Expected: 全绿，`ass.test.ts` 里原有的 `fitSizePx` 用例一条不改照样通过。

- [ ] **Step 4: 提交**

```bash
git add packages/db/src/booklist/fitSize.ts packages/db/src/booklist/fitSize.test.ts packages/db/src/index.ts worker/src/render/ffmpeg/ass.ts
git commit -m "refactor(ass): fitSizePx 抽到 packages/db —— 后台画布与渲染层共用同一份缩排逻辑"
```

---

## Task 19: `StageCanvas` 组件（静态渲染）

**Files:**
- Create: `web/components/admin/StageCanvas.tsx`
- Create: `web/components/admin/StageCanvas.test.tsx`

**Interfaces:**
- Consumes: Task 18 的 `fitSizePx`；Task 16 的 `FontOption`；`TextParams` / `TemplateParams`
- Produces:
  ```ts
  export type StageScene = 'open' | 'flash' | 'body'
  export type StageBg = 'placeholder' | 'light' | 'dark' | { url: string }
  export type StageSample = { caption: string; captionEn?: string; bookTitle?: string; bookAuthor?: string; openTitle?: string; watermark?: string }
  export type StageLayer = 'caption' | 'bookTitle' | 'flashTitle' | 'openTitle'
  export function StageCanvas(props: {
    width: number; height: number
    text: TextParams; captionColor: string; captionPosY: number
    fonts: FontOption[]
    scene: StageScene; onScene: (s: StageScene) => void
    bg: StageBg; onBg: (b: StageBg) => void
    sample: StageSample
    selected: StageLayer | null; onSelect: (l: StageLayer | null) => void
    onPosY: (layer: StageLayer, v: number) => void
    onSize: (layer: StageLayer, v: number) => void
  }): JSX.Element
  ```

- [ ] **Step 1: 写失败测试**

`web/components/admin/StageCanvas.test.tsx`（用 vitest + `@testing-library/react`；若仓库还没装，先 `npm i -D @testing-library/react @testing-library/jest-dom jsdom -w web` 并在 `vitest.config.ts` 的 `test` 里加 `environment: 'jsdom'`）：

```tsx
describe('StageCanvas', () => {
  const text = { ...DEFAULT_TEXT_PARAMS }
  const sample = { caption: '这是一句字幕', captionEn: 'This is a caption', bookTitle: '活着', openTitle: '今天分享的是' }

  it('正片场景画出正文字幕、书名大标题、水印', () => {
    render(<StageCanvas {...base} scene="body" sample={{ ...sample, watermark: '@东方文澜' }} />)
    expect(screen.getByTestId('layer-caption')).toHaveTextContent('这是一句字幕')
    expect(screen.getByTestId('layer-bookTitle')).toHaveTextContent('《活着》')
    expect(screen.getByTestId('layer-watermark')).toBeInTheDocument()
  })

  it('开场场景只画开场标题', () => {
    render(<StageCanvas {...base} scene="open" sample={sample} />)
    expect(screen.getByTestId('layer-openTitle')).toBeInTheDocument()
    expect(screen.queryByTestId('layer-caption')).toBeNull()
  })

  it('开了双语时字幕层多一行英文', () => {
    render(<StageCanvas {...base} scene="body" text={{ ...text, bilingual: true }} sample={sample} />)
    expect(screen.getByTestId('layer-caption')).toHaveTextContent('This is a caption')
  })

  it('关了双语时不画英文', () => {
    render(<StageCanvas {...base} scene="body" text={{ ...text, bilingual: false }} sample={sample} />)
    expect(screen.getByTestId('layer-caption')).not.toHaveTextContent('This is a caption')
  })

  it('★ 图层的 top 用真实像素，与 posY × 画面高一致（零换算）', () => {
    render(<StageCanvas {...base} width={720} height={1280} scene="body"
      text={{ ...text, bookTitlePosY: 0.25 }} sample={sample} />)
    expect(screen.getByTestId('layer-bookTitle')).toHaveStyle({ top: '320px' }) // 1280 * 0.25
  })

  it('★ 长书名按 fitSizePx 缩排，与成片一致', () => {
    const long = '我们生活在巨大的差距里'
    render(<StageCanvas {...base} width={720} height={1280} scene="body"
      sample={{ ...sample, bookTitle: long }} />)
    const expected = fitSizePx(`《${long}》`, Math.round(text.captionSizePx * text.bookTitleScale * text.bookTitleBoost), 720)
    expect(screen.getByTestId('layer-bookTitle')).toHaveStyle({ fontSize: `${expected}px` })
  })

  it('点选图层触发 onSelect', async () => {
    const onSelect = vi.fn()
    render(<StageCanvas {...base} scene="body" sample={sample} onSelect={onSelect} />)
    await userEvent.click(screen.getByTestId('layer-caption'))
    expect(onSelect).toHaveBeenCalledWith('caption')
  })

  it('切底图为亮底时画布背景变浅', () => {
    render(<StageCanvas {...base} bg="light" scene="body" sample={sample} />)
    expect(screen.getByTestId('stage-bg')).toHaveStyle({ background: '#f2f2f2' })
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run web/components/admin/StageCanvas.test.tsx`

- [ ] **Step 3: 实现（本步只做静态渲染，拖拽留给 Task 20）**

关键实现要点，逐条落地：

```tsx
'use client'
// 剪辑参数的所见即所得画布。
//
// ★ 它是**模拟器不是渲染器**。真正出片的是 worker 的 ass.ts + libass。
// 保真靠三条，缺一条这块画布就会开始骗人：
//   1. 坐标 1:1 零换算 —— 缩放只发生在最外层 transform: scale()，
//      内部一律用真实像素（720×1280）。画布上的每个数字**就是**存进参数的数字。
//   2. 共享 fitSizePx —— 长书名的缩排走 packages/db 里那一份，与成片同一个函数。
//   3. 同一份字体二进制 —— 通过 /api/fonts/<id>/file 拿，就是 worker 渲染时
//      fontsdir 里的那个文件。
// 仍然存在的差异：字距、CJK 断行位置、描边叠加顺序。所以画布角上常驻
// 「示意预览，最终以成片为准」。
```

- 外层结构：
  ```tsx
  <div ref={boxRef} className="relative w-full overflow-hidden rounded border border-line">
    <div style={{ width, height, transform: `scale(${scale})`, transformOrigin: 'top left' }}>
      {/* 所有图层用真实像素绝对定位 */}
    </div>
  </div>
  ```
  `scale = boxWidth / width`，用 `ResizeObserver` 跟随容器宽度；外层高度设为 `height * scale`。

- 描边：`WebkitTextStroke: `${text.outlinePx * 2}px #000``、`paintOrder: 'stroke'`。
  （`-webkit-text-stroke` 是**居中描边**，ASS 的 Outline 是外描边，所以宽度要 ×2 才观感接近。这条要写进代码注释。）

- 各层定位（**全部居中锚定，与 ASS 的 an2 / an5 + `\pos(cx,y)` 对齐**）：

  | 层 | `top` | `transform` | 字号 |
  |---|---|---|---|
  | `caption` | `height * captionPosY` | `translate(-50%, -100%)` | `captionSizePx` |
  | `bookTitle` | `height * bookTitlePosY` | `translate(-50%, -50%)` | `fitSizePx('《x》', round(captionSizePx*bookTitleScale*bookTitleBoost), width)` |
  | `flashTitle` | `height * flashTitlePosY` | `translate(-50%, -50%)` | `fitSizePx('《x》', round(captionSizePx*flashTitleScale), width)` |
  | `flashAuthor` | `flashTitle 的 top + flashTitleSizePx*0.95` | `translate(-50%, -50%)` | `round(captionSizePx*flashTitleScale*0.42)` |
  | `openTitle` | `height * openTitlePosY` | `translate(-50%, -50%)` | `round(captionSizePx*openTitleScale)` |
  | `watermark` | 右上角，`right: 24, top: 24` | — | 22px，`opacity: 0.62` |

  `left: '50%'` 统一给。各系数（`0.95`、`0.42`）与 `ass.ts` 里的 `fay` 计算和 `TITLE_SUB_RATIO` 一一对应，**要在代码里注释指明来源文件与常量名**。

- 双语行：`caption` 层内部第二个 `<div>`，字号 `round(captionSizePx * enScale)`、颜色 `enColor`、`marginTop: enGapPx`。因为 `caption` 用 `translate(-50%, -100%)`（底边锚点），英文往下长会把中文顶上去 —— 与 ASS 一样，所以给 `caption` 容器加 `paddingBottom: bilingual ? enPx * 1.2 + enGapPx : 0` 抵消。**这里的抵消公式要与 `ass.ts` 的 `bilingualExtraPx` 保持同口径，代码里注明。**

- 字体：`useEffect` 里对 `fonts` 逐个 `new FontFace(f.family, `url(/api/fonts/${f.id}/file)`)` → `document.fonts.add()`，各层 `fontFamily` 取对应 id 的 family（认不出回退默认）。

- 底图：`data-testid="stage-bg"` 的绝对定位 div，`placeholder` = 中性灰渐变、`light` = `#f2f2f2`、`dark` = `#141414`、`{url}` = `background-image`。

- 场景 tab 与底图单选放画布**上方**，`data-testid="stage-scene-tabs"` / `stage-bg-picker`。

- 画布右下角常驻 `<span className="text-[10px] text-ink3">示意预览，最终以成片为准</span>`。

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run web/components/admin/StageCanvas.test.tsx && npm test`
Expected: 全绿

- [ ] **Step 5: 提交**

```bash
git add web/components/admin/StageCanvas.tsx web/components/admin/StageCanvas.test.tsx vitest.config.ts package.json package-lock.json
git commit -m "feat(admin): 剪辑参数画布组件 —— 坐标 1:1、共用 fitSizePx 与同一份字体"
```

---

## Task 20: 画布拖拽交互

**Files:**
- Modify: `web/components/admin/StageCanvas.tsx`
- Modify: `web/components/admin/StageCanvas.test.tsx`

**Interfaces:**
- Consumes: Task 19 的 `onPosY` / `onSize`

- [ ] **Step 1: 写失败测试**

```tsx
it('纵向拖拽图层触发 onPosY，值 = 拖到的像素 / 画面高', async () => {
  const onPosY = vi.fn()
  render(<StageCanvas {...base} width={720} height={1280} scene="body" onPosY={onPosY} />)
  const layer = screen.getByTestId('layer-caption')
  fireEvent.pointerDown(layer, { clientY: 0 })
  fireEvent.pointerMove(window, { clientY: 64 })   // scale=1 的测试环境下即 64px
  fireEvent.pointerUp(window)
  expect(onPosY).toHaveBeenCalledWith('caption', expect.closeTo(0.78 + 64 / 1280, 4))
})

it('posY 夹在 0..1', async () => {
  const onPosY = vi.fn()
  render(<StageCanvas {...base} width={720} height={1280} scene="body" onPosY={onPosY} />)
  fireEvent.pointerDown(screen.getByTestId('layer-caption'), { clientY: 0 })
  fireEvent.pointerMove(window, { clientY: 9999 })
  fireEvent.pointerUp(window)
  expect(onPosY).toHaveBeenLastCalledWith('caption', 1)
})

it('水平移动完全不影响 —— ASS 里所有文字层都是居中锚定，给水平自由度等于骗人', async () => {
  const onPosY = vi.fn()
  render(<StageCanvas {...base} scene="body" onPosY={onPosY} />)
  fireEvent.pointerDown(screen.getByTestId('layer-caption'), { clientY: 0, clientX: 0 })
  fireEvent.pointerMove(window, { clientY: 0, clientX: 300 })
  fireEvent.pointerUp(window)
  expect(onPosY).toHaveBeenLastCalledWith('caption', 0.78)
})

it('拖底部把手改字号', async () => {
  const onSize = vi.fn()
  render(<StageCanvas {...base} scene="body" selected="caption" onSize={onSize} />)
  fireEvent.pointerDown(screen.getByTestId('handle-caption'), { clientY: 0 })
  fireEvent.pointerMove(window, { clientY: 10 })
  fireEvent.pointerUp(window)
  expect(onSize).toHaveBeenCalled()
})

it('把手只在该层被选中时出现', () => {
  render(<StageCanvas {...base} scene="body" selected={null} />)
  expect(screen.queryByTestId('handle-caption')).toBeNull()
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run web/components/admin/StageCanvas.test.tsx`

- [ ] **Step 3: 实现**

- 用 Pointer Events（`onPointerDown` + `window` 上的 `pointermove`/`pointerup`），不用 HTML5 drag（drag 在有 `transform: scale` 的容器里坐标会错）。
- 拖拽换算：`newPosY = clamp(startPosY + (clientY - startY) / scale / height, 0, 1)`。
  **注意除以 `scale`** —— 鼠标走的是屏幕像素，图层坐标是画面真实像素。
- **只读 `clientY`，完全不读 `clientX`。**
- 字号把手：选中层的正下方一个 8px 高的横条，`data-testid={`handle-${layer}`}`。
  - `caption` 层 → `onSize('caption', clamp(startPx + dy/scale, 20, 120))`（改 `captionSizePx`）
  - 其余层 → 改各自的 `*Scale`：`clamp(startScale + dy / scale / captionSizePx, 0.2, 5)`
- 拖拽中给 `document.body` 加 `cursor: ns-resize` 与 `user-select: none`，`pointerup` 时清掉。

- [ ] **Step 4: 跑测试确认通过**

Run: `npm test`
Expected: 全绿

- [ ] **Step 5: 提交**

```bash
git add web/components/admin/StageCanvas.tsx web/components/admin/StageCanvas.test.tsx
git commit -m "feat(admin): 画布图层纵向拖拽调位置、把手拖拽调字号"
```

---

## Task 21: 接入两个工作台 + 补齐三个 PosY 输入框

**Files:**
- Modify: `web/app/admin/frameworks/[id]/studio/page.tsx`
- Modify: `web/app/admin/generate/[id]/studio/page.tsx`
- Modify: `web/components/admin/paramControls.tsx`（`TextRows` 加三个 `PosY`）

**Interfaces:**
- Consumes: Task 19/20 的 `StageCanvas`

**顺带解锁的死参数**：`text.openTitlePosY / flashTitlePosY / bookTitlePosY` 早就在 `paramsWhitelist.ts` 里放行了，但 `TextRows` 里从来没有对应控件 —— 运营根本调不到。这次一并补上，与拖拽双向绑定。

- [ ] **Step 1: `TextRows` 补三个输入框**

在 `TextRows` 里，各 `*Scale` 行的旁边分别加：

```tsx
      <NumRow label="书名标题竖直位置" value={t.bookTitlePosY} disabled={props.disabled}
        min={0} max={1} step={0.01} hint="0 = 顶端，1 = 底端；也可在预览画布上直接拖"
        onChange={(v) => set({ bookTitlePosY: v })} />
      <NumRow label="快闪书名竖直位置" value={t.flashTitlePosY} disabled={props.disabled}
        min={0} max={1} step={0.01} hint="也可在预览画布上直接拖" onChange={(v) => set({ flashTitlePosY: v })} />
      <NumRow label="开场标题竖直位置" value={t.openTitlePosY} disabled={props.disabled}
        min={0} max={1} step={0.01} hint="也可在预览画布上直接拖" onChange={(v) => set({ openTitlePosY: v })} />
```

`TextParams` 类型补 `bookTitlePosY / flashTitlePosY / openTitlePosY: number`（三者早就在 `TemplateParams.text` 里，只是前端类型没声明）。

- [ ] **Step 2: 框架级工作台接入画布**

在 `web/app/admin/frameworks/[id]/studio/page.tsx`：

- 新 state：`const [scene, setScene] = useState<StageScene>('body')`、`const [bg, setBg] = useState<StageBg>('placeholder')`、`const [sel, setSel] = useState<StageLayer | null>(null)`、`const [fonts, setFonts] = useState<FontOption[]>([])`
- `load()` 里并行拉字体列表
- 在 `PageHeader` 之后、各 `Section` 之前插一个 sticky 的画布卡片：

```tsx
      {text && (
        <section className="card space-y-3 p-4 lg:sticky lg:top-4">
          <div className="flex items-center justify-between">
            <p className="eyebrow">画面预览 · 可直接拖</p>
            <button className="btn-ghost text-xs disabled:opacity-50" disabled={!!busy}
              onClick={() => save({ text, body: { subtitleColor: capColor, subtitlePosY: capPosY } }, '画面')}>
              {busy === '画面' ? '保存中…' : '保存画面'}
            </button>
          </div>
          <StageCanvas
            width={720} height={1280}
            text={text} captionColor={capColor} captionPosY={capPosY} fonts={fonts}
            scene={scene} onScene={setScene} bg={bg} onBg={setBg}
            sample={{ caption: '这是一句示例字幕', captionEn: 'This is a sample caption',
              bookTitle: '活着', bookAuthor: '余华', openTitle: '今天分享的是' }}
            selected={sel} onSelect={setSel}
            onPosY={(layer, v) => {
              if (layer === 'caption') setCapPosY(v)
              else setText({ ...text, [`${layer}PosY`]: v } as TextParams)
            }}
            onSize={(layer, v) => setText({
              ...text,
              ...(layer === 'caption' ? { captionSizePx: v } : { [`${layer}Scale`]: v }),
            } as TextParams)}
          />
        </section>
      )}
```

> `StageLayer` 的取值（`'bookTitle' | 'flashTitle' | 'openTitle'`）与 `TextParams` 的键前缀（`bookTitlePosY` / `flashTitlePosY` / `openTitlePosY`、`bookTitleScale` / `flashTitleScale` / `openTitleScale`）刻意保持一致，模板字符串拼键才成立。**改任一处必须同步另一处。**

- [ ] **Step 3: 任务级工作台接入**

同样接入 `web/app/admin/generate/[id]/studio/page.tsx`，区别是 `sample` 与 `bg` 用**本条任务的真实数据**：
- 从任务详情接口拿第一段的 `scriptText` / `captionBeats[0]`（中英）、`bookTitle` / `bookAuthor`
- `bg` 默认取该任务第一张配图（走已有的缩略图接口，`.thumb.webp` 优先）；拉不到时回退 `'placeholder'`

若现有接口没返回这些字段，**在该页已有的加载接口里补上**（而不是新开一个接口）。

- [ ] **Step 4: 类型检查 + 测试 + 跑起来看一眼**

Run: `npx tsc --noEmit -p web/tsconfig.json && npm test`
Expected: 无错、全绿

手动验收（用 `superpowers:verification-before-completion` 的要求：先看到证据再说完成）：
1. 起本地环境，进 `/admin/frameworks/<某个框架>/studio`
2. 拖动正文字幕层 → 右侧「正文字幕竖直位置」数字跟着变
3. 改「英文字号倍数」→ 画布上英文行跟着变，**中文行纹丝不动**
4. 换字体下拉 → 画布上字形真的变了
5. 点「保存画面」→ 刷新页面数值还在

- [ ] **Step 5: 更新 README**

在「管理员端」的剪辑参数条目里补：

```markdown
剪辑参数页带**所见即所得画布**：按真实分辨率等比缩放，可切「开场 / 快闪卡 / 正片」三个场景与「占位图 / 亮底 / 暗底 / 自传图」四种底图，文字层可直接拖动改竖直位置、拖把手改字号，改完的数值即是存进参数的数值。画布与成片共用同一份字体文件与同一套长标题缩排逻辑，但仍是示意预览，最终以成片为准。
```

- [ ] **Step 6: 提交**

```bash
git add web/ README.md
git commit -m "feat(admin): 剪辑参数接入画面编辑画布 —— 两个工作台共用，顺带解锁三个位置参数"
```

---

## 收尾检查清单

全部任务完成后逐条确认（**每条都要有实际运行的输出作为证据，不能凭印象**）：

- [ ] `npm test` 全绿
- [ ] `RENDER_E2E=1 npx vitest run worker/src/render/ffmpeg/` 全绿（需本机 ffmpeg）
- [ ] `npx tsc --noEmit -p web/tsconfig.json` 无错
- [ ] 用一个**没配过任何新参数的老框架**生成一条片子，成片与改动前逐帧一致（零回归）
- [ ] 用一个**开了双语 + 换了字体**的框架生成一条，成片上中英两行都在、字体确实变了
- [ ] README 三处更新都在
- [ ] 部署注意：`data/fonts/` 目录要在生产的挂载卷里（对齐 `data/materials` 的挂载方式，检查 `docker-compose.prod.yml`）
- [ ] 部署注意：`prisma migrate deploy` 要跑（`CustomFont` 表）
