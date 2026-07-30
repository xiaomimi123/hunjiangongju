# 剪映工程复刻 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** 确定性解析剪映 `draft_content.json`，抽取剪辑配方产出现有 `TemplateParams`（booklist-flash 契约），存为可复用框架；生成套 AI 新图 + 火山配音做"同款"。取代「拆解」。

**Architecture:** 纯函数解析器（packages/db，web+worker 共享）→ web 上传/预览/保存接口 → 存进 framework.overlayTemplate.__templateParams → 现有 flash 渲染消费（不改）。

**Tech Stack:** TypeScript monorepo（web Next.js / worker / packages/db @mixcut/db，index-only 导出），vitest。

设计依据：`docs/superpowers/specs/2026-07-30-jianying-draft-replication-design.md`；实地样例 `今天分享的是/draft_content.json`（720×960 / 24.6s）。

## Global Constraints
- 不改渲染/生成流程与 `TemplateParams` 结构；无数据库迁移；纯函数可单测；现有全部测试回归绿。
- 解析器最终对象经 worker 现有 `parseTemplateParams` 消费端再规整（双保险）。
- `@mixcut/db` 只有 index (`src/index.ts`) 导出；web 只 `from '@mixcut/db'`。
- 坐标换算：剪映 `clip.transform.y`（中心原点，负=上/正=下，范围约 -1..1）→ 屏幕归一化 `y_norm = 0.5 + transform.y/2`（clamp 0..1）。
- 颜色：`[r,g,b]`（0..1）→ `#RRGGBB`。
- 时长：μs → ms（`Math.round(us/1000)`）。
- 运营(operator)鉴权 + 限流沿用现有 `/api/admin/*` 与 tts preview 的写法。

---

## Task 1：把 TemplateParams 契约移到 @mixcut/db（web/worker 共享），worker 保留 re-export shim

**Files:**
- Create: `packages/db/src/booklist/templateParams.ts`（= 现 worker 版内容原样移入）
- Modify: `packages/db/src/index.ts`（导出 templateParams 公共符号）
- Modify: `worker/templates/booklist/templateParams.ts`（改为从 `@mixcut/db` re-export 的 shim）
- Test: `packages/db/src/booklist/templateParams.test.ts`（把 worker 的同名测试内容移来，import 改指本地）

**Interfaces:**
- Produces：`@mixcut/db` 导出 `TemplateParams`、`TemplateMode`、`DEFAULT_PARAMS`、`parseTemplateParams`、`FlashTimeline`、`flashTimeline`（签名与现 worker 版完全一致）。
- worker 内 9 处 `import ... from '.../templateParams'` 通过 shim 原样可用（零改动）。

- [ ] **Step 1: 移动文件**
把 `worker/templates/booklist/templateParams.ts` 的**全部内容**原样写入新文件 `packages/db/src/booklist/templateParams.ts`（该文件无任何 import，纯 TS，可直接移）。

- [ ] **Step 2: db index 导出**
在 `packages/db/src/index.ts` 末尾追加：
```ts
export {
  DEFAULT_PARAMS,
  parseTemplateParams,
  flashTimeline,
} from './booklist/templateParams.js'
export type { TemplateParams, TemplateMode, FlashTimeline } from './booklist/templateParams.js'
```
（`.js` 扩展名遵循本仓 nodenext + ESM 约定。）

- [ ] **Step 3: worker shim**
把 `worker/templates/booklist/templateParams.ts` 整个内容替换为：
```ts
// 契约已移至 @mixcut/db（web 上传接口与 worker 渲染共享同一份）。此处 re-export 保持 worker 内既有 import 路径不变。
export { DEFAULT_PARAMS, parseTemplateParams, flashTimeline } from '@mixcut/db'
export type { TemplateParams, TemplateMode, FlashTimeline } from '@mixcut/db'
```

- [ ] **Step 4: 移动/改测试**
把 `worker/templates/booklist/templateParams.test.ts` 内容移入 `packages/db/src/booklist/templateParams.test.ts`，import 改为 `from './templateParams'`；删除 worker 侧旧测试文件（避免重复）。

- [ ] **Step 5: 运行相关测试 + tsc**
```
DATABASE_URL=postgresql://mixcut:mixcut@localhost:55433/mixcut_test?schema=public npx vitest run packages/db/src/booklist/templateParams.test.ts worker/src/gen/renderVisuals.flash.test.ts worker/templates/booklist/indexHtml.flash.test.ts
npx tsc --noEmit -p worker/tsconfig.json
```
Expected: 全绿，tsc exit 0（9 处 worker import 经 shim 正常）。

- [ ] **Step 6: 提交** `refactor(booklist): TemplateParams 契约移入 @mixcut/db,worker re-export`

---

## Task 2：`parseJianyingDraft` 解析器（packages/db，纯函数 + 夹具测试）

**Files:**
- Create: `packages/db/src/booklist/parseJianyingDraft.ts`
- Modify: `packages/db/src/index.ts`（导出 `parseJianyingDraft`、`DraftMeta`）
- Test: `packages/db/src/booklist/parseJianyingDraft.test.ts`

**Interfaces:**
- Consumes：`TemplateParams`、`DEFAULT_PARAMS`（Task 1，`from './templateParams.js'`）。
- Produces：
```ts
export interface DraftMeta {
  canvas: { width: number; height: number }
  durationMs: number
  segmentCount: number      // video track 段数
  fontsNeeded: string[]     // 去重的字体名（不含路径），如 ['字由玄真','三极极宋 超粗新']
  bookTitles: string[]      // 从文字素材《》抽取
  warnings: string[]
}
export function parseJianyingDraft(draft: unknown): { params: TemplateParams; meta: DraftMeta }
```

**样例字段路径（已实地确认，实现前请对照 `今天分享的是/draft_content.json` 校验）：**
- 画布：`draft.canvas_config.{width,height}`（720×960）。总时长：`draft.duration`(μs)。
- 视频段数：`tracks[type==='video'].segments.length`（14）。
- materials 索引：`texts/{id}`、`material_animations/{id}`、`transitions/{id}`、`audios/{id}`。
- 文字素材 `content` 是 JSON 字符串：`JSON.parse(content).text` 为纯文本；`.styles[0].font.path`（`text/<hash>/字由玄真.ttf` → basename 去 `.ttf` = 字体名）；`.styles[0].fill.content.solid.color` = `[r,g,b]`。
- sticker track 段：`target_timerange.{start,duration}`、`clip.transform.y`、`extra_material_refs`（含 transitions / material_animations 的 id）。
- **开场标题**：sticker 段中 `start` 最小(或缺省视为0)、`transform.y<0`(上方) 且文本非《》书名 的那段 → `open.titleText`=其文本、`open.durationMs`=其 duration(μs→ms，样例 2159)。开场动画：任一 `material_animations.animations[].name` 含 `破镜重圆`/`收拢` → 记 `open.shatter=true`（含"破镜"关键字才置 shatter；否则默认）。
- **书名快闪**：sticker 段中文本匹配 `《…》`、`transform.y>0`(下方) 且 duration 较短(<800ms) 的那批 → `flash.perClipMs`=这批 duration 的平均(ms)、`flash.minClipMs`=最小值。
- **正片字幕**：sticker 段中文本**非**《》、且非开场标题、duration 较长或成句 的 → 取其 `font`→`body.subtitleFontFamily`(family key 映射)、`fill.color`→`body.subtitleColor`(#hex)、`transform.y`→`body.subtitlePosY`(0.5+y/2)。
- **转场**：`materials.transitions[].duration`(μs) → 取出现最多/较大的一档 → `transition.durationMs`（样例叠化 300/500 → 取 500）。`type` 固定 'dissolve'。
- **Ken-Burns**：任一 video 段 `extra_material_refs` 指向的 `material_animations` 有缩放/位移动画 → `body.kenBurns='subtle'` 否则 'off'（简化：material_animations 里存在 type 含 'video' 的动画即 subtle；否则 off）。
- **音频**：`audios[].name` + 段 `volume`。含「歌曲/音乐」类且时长最长 → BGM，其 `volume`→`audio.bgmVolume`(样例 0.692)。名字含「齿轮/旋钮」→ `audio.sfx.openGear=true`；含「水滴」→ `audio.sfx.transitionDrop=true`。`open.sfx` = openGear。
- **fontsNeeded**：所有文字素材 font.path 的 basename 去重（`字由玄真`、`三极极宋 超粗新`、`莫雪体`…）。
- **bookTitles**：所有文字素材文本用 `/《([^》]+)》/g` 抽取、去重、trim。
- 字体名→family key 映射表（未命中回退默认 + warning）：`{'字由玄真':'flash-title','三极极宋 超粗新':'flash-title','莫雪体':'subtitle'}`。
- warnings：画布非 720×960、无 flash 书名段、fontsNeeded 有未映射项 等，push 文案，**不抛错**。

**健壮性**：每个字段"取不到→用 `DEFAULT_PARAMS` 对应值 + 视情况 push warning"；仅当 `draft` 非对象时可返回全默认 + warning。最终 `params` 再过一遍 `parseTemplateParams` 兜底。

- [ ] **Step 1: 失败测试（夹具）**
`packages/db/src/booklist/parseJianyingDraft.test.ts`——用**精简内联夹具**（不依赖真文件）覆盖关键行为：
```ts
import { describe, it, expect } from 'vitest'
import { parseJianyingDraft } from './parseJianyingDraft'

const draft = {
  canvas_config: { width: 720, height: 960 },
  duration: 24601783,
  materials: {
    texts: [
      { id: 't_title', content: JSON.stringify({ text: '今天分享的是', styles: [{ font: { path: 'text/x/字由玄真.ttf' }, fill: { content: { solid: { color: [0,0,0] } } } }] }) },
      { id: 't_b1', content: JSON.stringify({ text: '《活着》', styles: [{ font: { path: 'text/x/字由玄真.ttf' }, fill: { content: { solid: { color: [0,0,0] } } } }] }) },
      { id: 't_sub', content: JSON.stringify({ text: '没有人能替你抚平情绪', styles: [{ font: { path: 'text/y/莫雪体.ttf' }, fill: { content: { solid: { color: [1,1,1] } } } }] }) },
    ],
    material_animations: [{ id: 'a1', animations: [{ name: '破镜重圆' }] }],
    transitions: [{ id: 'tr1', name: '叠化', duration: 500000 }],
    audios: [
      { id: 'au_bgm', name: '歌曲20260702' }, { id: 'au_gear', name: '发条旋钮转动齿轮' }, { id: 'au_drop', name: '一滴水滴声' },
    ],
  },
  tracks: [
    { type: 'video', segments: [ { target_timerange: { duration: 2158988 } }, { target_timerange: { duration: 3000000 } } ] },
    { type: 'audio', segments: [ { material_id: 'au_bgm', volume: 0.692, target_timerange: { start: 0, duration: 20000000 } } ] },
    { type: 'audio', segments: [ { material_id: 'au_gear', target_timerange: { start: 2158988, duration: 1800000 } } ] },
    { type: 'audio', segments: [ { material_id: 'au_drop', volume: 0.51, target_timerange: { start: 3984033, duration: 500000 } } ] },
    { type: 'sticker', segments: [
      { material_id: 't_title', target_timerange: { start: 0, duration: 2158988 }, clip: { transform: { y: -0.62 } }, extra_material_refs: ['a1'] },
      { material_id: 't_b1', target_timerange: { start: 2158988, duration: 150300 }, clip: { transform: { y: 0.66 } }, extra_material_refs: [] },
      { material_id: 't_sub', target_timerange: { start: 15509000, duration: 2321000 }, clip: { transform: { y: -0.486 } }, extra_material_refs: [] },
    ] },
  ],
}

describe('parseJianyingDraft', () => {
  it('抽取 flash 配方核心字段', () => {
    const { params, meta } = parseJianyingDraft(draft)
    expect(params.mode).toBe('flash')
    expect(params.open.titleText).toBe('今天分享的是')
    expect(params.open.durationMs).toBe(2159)          // 2158988μs→ms
    expect(params.open.shatter).toBe(true)             // 破镜重圆
    expect(params.transition.durationMs).toBe(500)     // 叠化 500000μs
    expect(params.audio.bgmVolume).toBeCloseTo(0.692, 2)
    expect(params.audio.sfx.openGear).toBe(true)       // 齿轮
    expect(params.audio.sfx.transitionDrop).toBe(true) // 水滴
    expect(params.flash.perClipMs).toBe(150)           // 书名段 150300μs→150ms
  })
  it('meta：画布/字体/书名', () => {
    const { meta } = parseJianyingDraft(draft)
    expect(meta.canvas).toEqual({ width: 720, height: 960 })
    expect(meta.segmentCount).toBe(2)
    expect(meta.fontsNeeded).toEqual(expect.arrayContaining(['字由玄真', '莫雪体']))
    expect(meta.bookTitles).toContain('活着')
    expect(meta.durationMs).toBe(24602)
  })
  it('字幕样式：字体/颜色/位置换算', () => {
    const { params } = parseJianyingDraft(draft)
    expect(params.body.subtitleFontFamily).toBe('subtitle')     // 莫雪体→subtitle
    expect(params.body.subtitleColor).toBe('#ffffff')           // [1,1,1]
    expect(params.body.subtitlePosY).toBeCloseTo(0.5 + (-0.486)/2, 3) // 0.257
  })
  it('非对象/空 → 全默认不抛错', () => {
    expect(() => parseJianyingDraft(null)).not.toThrow()
    const { params, meta } = parseJianyingDraft({})
    expect(params.mode).toBe('flash')
    expect(meta.warnings.length).toBeGreaterThan(0)
  })
})
```

- [ ] **Step 2: 运行确认失败**
`npx vitest run packages/db/src/booklist/parseJianyingDraft.test.ts` → FAIL（模块不存在）。

- [ ] **Step 3: 实现 `parseJianyingDraft.ts`**
按上面「样例字段路径」实现。必须包含以下纯函数（全部导出以便单测/复用）：
```ts
export function usToMs(us: unknown): number { return typeof us === 'number' && Number.isFinite(us) ? Math.round(us / 1000) : 0 }
export function rgbToHex(c: unknown): string | undefined {
  if (!Array.isArray(c) || c.length < 3) return undefined
  const h = (n: unknown) => Math.max(0, Math.min(255, Math.round((typeof n === 'number' ? n : 0) * 255))).toString(16).padStart(2, '0')
  return `#${h(c[0])}${h(c[1])}${h(c[2])}`
}
export function transformYToNorm(y: unknown): number {
  const v = typeof y === 'number' ? y : 0
  return Math.max(0, Math.min(1, 0.5 + v / 2))
}
export function fontBasename(path: unknown): string | undefined {
  if (typeof path !== 'string' || !path) return undefined
  const base = path.split('/').pop() || path
  return base.replace(/\.(ttf|otf|ttc)$/i, '').trim() || undefined
}
```
主函数用 try/catch 包裹每一块抽取，缺失走 `DEFAULT_PARAMS`，最后 `return { params: parseTemplateParams({ ...built, mode: 'flash' }), meta }`。字体映射表 + warnings 逻辑见上。

- [ ] **Step 4: 通过 + tsc**
`npx vitest run packages/db/src/booklist/parseJianyingDraft.test.ts`（全绿）；`npx tsc --noEmit -p worker/tsconfig.json`（exit 0）。

- [ ] **Step 5: db 导出**
`packages/db/src/index.ts` 追加 `export { parseJianyingDraft } from './booklist/parseJianyingDraft.js'` 与 `export type { DraftMeta } from './booklist/parseJianyingDraft.js'`。

- [ ] **Step 6: 提交** `feat(booklist): parseJianyingDraft 解析剪映草稿抽取 TemplateParams`

---

## Task 3：Web 接口 —— 解析预览 + 保存为框架

**Files:**
- Create: `web/app/api/admin/jianying/parse/route.ts`
- Create: `web/app/api/admin/jianying/save/route.ts`
- Test: `web/app/api/admin/jianying/parse/route.test.ts`

**Interfaces:**
- Consumes：`parseJianyingDraft`（`from '@mixcut/db'`）；现有 operator 鉴权 helper + 限流（参照 `web/app/api/tts/preview/route.ts`）；框架创建逻辑（参照现有框架保存接口——实现前先读现有 `/api/admin/frameworks` 或等价写法，复用之）。

- [ ] **Step 1: 失败测试** `parse/route.test.ts`
断言：非 operator → 401/403；body 缺 draft → 400；传入 §Task2 夹具的 `draft_content.json` JSON → 200，返回 `{ templateParams, meta }` 且 `templateParams.mode==='flash'`、`meta.bookTitles` 含 '活着'。（mock 鉴权按现有测试套路。）

- [ ] **Step 2: 运行失败** `npx vitest run web/app/api/admin/jianying/parse/route.test.ts`。

- [ ] **Step 3: 实现 parse route**
`POST`：operator 鉴权 + `checkRate`；读 body（`{ draftJson: <object|string> }`，字符串则 `JSON.parse`，失败→400「不是合法的 draft_content.json」）；`const { params, meta } = parseJianyingDraft(draftJson)`；返回 `{ templateParams: params, meta }`。**不落库**。
> v1 仅接受 `draft_content.json`（对象或文本）。zip 解压留作后续（避免引入 zip 依赖），在返回文案与文档中说明"请上传草稿里的 draft_content.json"。

- [ ] **Step 4: 实现 save route**
`POST`：operator 鉴权；body `{ name: string, templateParams: object }`；校验 name 非空、templateParams 经 `parseTemplateParams` 规整；创建一条框架记录，`overlayTemplate.__templateParams = 规整后的 params`（`mode:'flash'`）。复用现有框架创建路径（读现有实现照做，勿另造表）。返回新框架 id。

- [ ] **Step 5: 通过 + web 构建**
`npx vitest run web/app/api/admin/jianying/parse/route.test.ts`；`npm run build -w web`（忽略既有 postgres 静态告警）。

- [ ] **Step 6: 提交** `feat(web): 剪映草稿解析预览 + 保存为框架接口`

---

## Task 4：后台「剪映模板」页 + 隐藏「拆解」入口

**Files:**
- Create: `web/app/admin/jianying/page.tsx`
- Modify: 后台侧栏导航组件（实现前 grep `拆解`/`extract` 定位导航文件）——新增「剪映模板」入口、移除/注释「拆解」入口（保留其路由与页面文件，仅不在导航展示）。

- [ ] **Step 1: 剪映模板页**
上传 `draft_content.json`（`<input type=file accept=".json">` 读文本 或粘贴 JSON 文本框）→ 调 `/api/admin/jianying/parse` → 展示预览：画布、时长、分镜数、`fontsNeeded`(标出未内置的)、识别到的 `bookTitles`、`warnings`（醒目）。→ 填「框架名」+「保存为框架」按钮 → 调 `/api/admin/jianying/save` → 成功提示 + 跳框架库。遵循现有 admin 页 JSX/样式风格（参照 `web/app/admin/generate/page.tsx`）。

- [ ] **Step 2: 隐藏拆解入口**
在导航组件移除「拆解」链接（保留 `web/app/admin/extract` 及其路由文件）。新增「剪映模板」→ `/admin/jianying`。

- [ ] **Step 3: web 构建通过**
`npm run build -w web`。

- [ ] **Step 4: 提交** `feat(web): 后台剪映模板页 + 隐藏拆解入口`

---

## Self-Review
- 覆盖 spec：解析器(T2)+上传/预览/保存(T3)+前端与拆解隐藏(T4)+共享契约前置(T1)。
- 类型一致：`TemplateParams`/`parseTemplateParams` 单一来源(@mixcut/db)，parser 产出经其规整；web `from '@mixcut/db'`。
- 无迁移、不改渲染；坐标 `0.5+y/2`（已按真样例修正 spec 的反号）；μs→ms、rgb→hex 纯函数单测。
- YAGNI：v1 只吃 draft_content.json（zip 延后）；只学配方不还原素材；拆解隐藏不删。
- 风险点：T3 框架保存需照现有框架创建逻辑（实现者先读现有接口）；导航文件位置 T4 先 grep 定位。
