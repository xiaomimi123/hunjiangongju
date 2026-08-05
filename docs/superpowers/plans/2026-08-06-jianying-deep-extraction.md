# 剪映工程深度拆解 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 解析器读懂新版剪映工程（加密 + `text` 轨），并把调色、逐段运镜、文字动画、画面缩放提取出来由渲染层消费，把复刻度从「结构像」推到「质感像」。

**Architecture:** `packages/db` 纯函数解析（判据加固 + 四组新参数）→ `TemplateParams` 新增可选字段 → `worker/templates/booklist` 渲染消费 → web 页面加密回退与人话报告。新字段全可选，缺省时行为与现状逐字节一致。

**Tech Stack:** TypeScript monorepo（web Next.js / worker / packages/db `@mixcut/db`），vitest，HyperFrames(Chromium) + GSAP 渲染。

设计依据：`docs/superpowers/specs/2026-08-06-jianying-deep-extraction-design.md`（含实测数据表，判据来源）。

## Global Constraints

- 测试：`DATABASE_URL=postgresql://mixcut:mixcut@localhost:55433/mixcut_test?schema=public npx vitest run`（dev postgres：`docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d postgres`）。每任务结束跑相关测试 + `npx tsc --noEmit -p worker/tsconfig.json`（exit 0）；触 web 的任务加 `npm run build -w web`。
- **零回归铁律**：所有新字段可选；缺省时渲染输出与改动前**逐字节一致**（现有测试即证据，不得修改现有断言来"适配"新代码）。
- `@mixcut/db` 只从 `src/index.ts` 导出，**再导出不带 `.js` 扩展名**（web bundler resolution 不认带扩展名的）。worker 内部 `worker/templates/booklist/*.ts` 相对 import **要带 `.js`**（该目录既有约定，照抄邻居写法）。
- 解析器纯函数、**不抛错**：每块 try/catch，失败推 warning 并回落默认（沿用 `parseJianyingDraft.ts` 既有风格）。
- 测试夹具用**结构化最小对象**，不得把用户真实工程文件（`今天分享的是/`、桌面上的工程）拷进仓库。
- 剪映坐标：`transform.y` 中心原点、**向上为负**；时间单位微秒（μs→ms 用既有 `usToMs`）。
- 中文注释、中文提交信息，提交信息末尾带 `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`。

---

### Task 1: 解析判据加固（文字轨 text/sticker + 开场动画/音效放宽 + BGM 新判据）

**Files:**
- Modify: `packages/db/src/booklist/parseJianyingDraft.ts`
- Modify: `packages/db/src/booklist/draftMedia.ts`（BGM 判据与解析器统一）
- Test: `packages/db/src/booklist/parseJianyingDraft.test.ts`（扩展）、`packages/db/src/booklist/draftMedia.test.ts`（扩展）

**Interfaces:**
- Produces：`parseJianyingDraft` 与 `extractDraftMedia` 共用同一 BGM 判据；新增导出 `pickBgmSegment`（供两处复用与单测）：
  ```ts
  export interface BgmPick { materialId: string; name: string; volume: number; fileName?: string }
  export function pickBgmSegment(draft: unknown): BgmPick | null
  ```
  放在 `draftMedia.ts`，由 `parseJianyingDraft.ts` import（`packages/db` 内部相对 import，不带扩展名）。

- [ ] **Step 1: 写失败测试（draftMedia.test.ts 追加）**

```ts
const P = '##_draftpath_placeholder_X_##'
// 新模板口径：BGM 是被压低音量(<1)且覆盖最长的非音效轨；人声音量 3.94 被排除
const newStyle = {
  duration: 33_500_000,
  materials: {
    audios: [
      { id: 'a1', name: '一滴水滴声', path: `${P}/audio/drop.mp3`, type: 'sound' },
      { id: 'a2', name: '7.6.wav', path: `${P}/audio/7.6.wav`, type: 'extract_music' },
      { id: 'a3', name: '怎么说我不爱你（DJ前奏版）', path: `${P}/audio/song.mp3`, type: 'music' },
    ],
  },
  tracks: [
    { type: 'audio', segments: [{ material_id: 'a1', volume: 2.75, target_timerange: { start: 0, duration: 1_633_000 } }] },
    { type: 'audio', segments: [{ material_id: 'a2', volume: 3.94, target_timerange: { start: 0, duration: 23_900_000 } }] },
    { type: 'audio', segments: [{ material_id: 'a3', volume: 0.4425, target_timerange: { start: 0, duration: 33_500_000 } }] },
  ],
}
// 旧样例口径：BGM 音量 0.692 分两段共 25s；人声轨无 volume 字段被排除
const oldStyle = {
  duration: 24_602_000,
  materials: {
    audios: [
      { id: 'b1', name: '歌曲20260702-02', path: `${P}/audio/song.mp3`, type: 'extract_music' },
      { id: 'b2', name: '提取音乐20260702-02', path: `${P}/audio/voice.mov`, type: 'extract_music' },
    ],
  },
  tracks: [
    { type: 'audio', segments: [
      { material_id: 'b1', volume: 0.692, target_timerange: { start: 0, duration: 20_140_000 } },
      { material_id: 'b1', volume: 0.692, target_timerange: { start: 20_140_000, duration: 5_134_000 } },
    ] },
    { type: 'audio', segments: [{ material_id: 'b2', target_timerange: { start: 0, duration: 19_790_000 } }] },
  ],
}

describe('pickBgmSegment（音量<1 且覆盖最长的非音效轨）', () => {
  it('新模板：选中 music 轨,排除人声(vol 3.94)与音效', () => {
    expect(pickBgmSegment(newStyle)).toEqual({ materialId: 'a3', name: '怎么说我不爱你（DJ前奏版）', volume: 0.4425, fileName: 'song.mp3' })
  })
  it('旧样例：选中「歌曲」轨(多段合计),排除无音量的人声轨', () => {
    expect(pickBgmSegment(oldStyle)).toEqual({ materialId: 'b1', name: '歌曲20260702-02', volume: 0.692, fileName: 'song.mp3' })
  })
  it('无合格候选 → null', () => {
    expect(pickBgmSegment({ materials: { audios: [{ id: 'x', name: '齿轮', type: 'sound', path: `${P}/audio/g.mp3` }] }, tracks: [{ type: 'audio', segments: [{ material_id: 'x', volume: 0.5, target_timerange: { duration: 1000 } }] }] })).toBeNull()
    expect(pickBgmSegment(null)).toBeNull()
  })
})

describe('extractDraftMedia 用新判据取 BGM', () => {
  it('新模板：拿到 song.mp3 + 曲名', () => {
    expect(extractDraftMedia(newStyle).bgm).toEqual([{ fileName: 'song.mp3', title: '怎么说我不爱你（DJ前奏版）' }])
  })
  it('旧样例：仍拿到歌曲轨(向后兼容)', () => {
    expect(extractDraftMedia(oldStyle).bgm).toEqual([{ fileName: 'song.mp3', title: '歌曲20260702-02' }])
  })
})
```

- [ ] **Step 2: 写失败测试（parseJianyingDraft.test.ts 追加）**

```ts
const P = '##_draftpath_placeholder_X_##'
function textDraft(trackType: 'text' | 'sticker') {
  return {
    canvas_config: { width: 834, height: 1112 },
    duration: 33_500_000,
    materials: {
      texts: [
        { id: 't1', content: JSON.stringify({ text: '今天分享的是', styles: [{ font: { path: 'x/font.ttf' }, fill: { content: { solid: { color: [1, 1, 1] } } } }] }) },
        { id: 't2', content: JSON.stringify({ text: '@欧子好读', styles: [{ font: { path: 'a/SourceHanSerifCN-Heavy.otf' }, fill: { content: { solid: { color: [1, 1, 1] } } } }] }) },
      ],
      material_animations: [{ id: 'an1', animations: [{ name: '玻璃聚集', type: 'in', duration: 1_300_000 }] }],
      audios: [{ id: 'sfx1', name: '鼠标单击', type: 'sound', path: `${P}/audio/click.mp3` }],
    },
    tracks: [
      { type: trackType, segments: [
        { material_id: 't1', target_timerange: { start: 200_000, duration: 1_300_000 }, clip: { transform: { y: 0.374 } }, extra_material_refs: [] },
        { material_id: 't2', target_timerange: { start: 2_967_000, duration: 28_933_000 }, clip: { transform: { y: -0.793 } }, extra_material_refs: [] },
      ] },
      { type: 'audio', segments: [{ material_id: 'sfx1', target_timerange: { start: 5_167_000, duration: 367_000 } }] },
    ],
  }
}

describe('文字轨兼容 text 与 sticker', () => {
  it.each(['text', 'sticker'] as const)('%s 轨都能读出开场标题', (tt) => {
    const { params } = parseJianyingDraft(textDraft(tt))
    expect(params.open.titleText).toBe('今天分享的是')
  })
  it.each(['text', 'sticker'] as const)('%s 轨都能读出 @ 水印', (tt) => {
    const { meta } = parseJianyingDraft(textDraft(tt))
    expect(meta.watermark).toBe('@欧子好读')
  })
})

describe('开场动画与音效识别放宽', () => {
  it('「玻璃聚集」算碎裂开场', () => {
    expect(parseJianyingDraft(textDraft('text')).params.open.shatter).toBe(true)
  })
  it('「鼠标单击」算开场音效', () => {
    expect(parseJianyingDraft(textDraft('text')).params.audio.sfx.openGear).toBe(true)
  })
})
```

- [ ] **Step 3: 跑测试确认失败**

Run: `DATABASE_URL=... npx vitest run packages/db/src/booklist/draftMedia.test.ts packages/db/src/booklist/parseJianyingDraft.test.ts`
Expected: 新增用例 FAIL（`pickBgmSegment` 未导出 / 文字轨读不到 / `meta.watermark` 不存在）。

- [ ] **Step 4: 实现 `pickBgmSegment`（draftMedia.ts）**

在 `draftMedia.ts` 加（沿用文件里已有的 `obj`/`arr`/`basename` helper）：

```ts
export interface BgmPick { materialId: string; name: string; volume: number; fileName?: string }

/**
 * BGM 判据：排除 type==='sound' 的音效轨；在剩余音轨里取「音量有值且 < 1.0」中总覆盖时长最长者。
 * 依据：剪映里 BGM 必被压在人声之下（实测 新模板 0.4425 / 旧样例 0.692），人声轨音量 >= 1 或缺省。
 */
export function pickBgmSegment(draft: unknown): BgmPick | null {
  const d = obj(draft)
  const materials = obj(d.materials)
  const audios = new Map<string, Record<string, unknown>>()
  for (const raw of arr(materials.audios)) {
    const a = obj(raw)
    if (typeof a.id === 'string') audios.set(a.id, a)
  }
  const acc = new Map<string, { dur: number; volume: number }>()
  for (const rawTrack of arr(d.tracks)) {
    const track = obj(rawTrack)
    if (track.type !== 'audio') continue
    for (const rawSeg of arr(track.segments)) {
      const seg = obj(rawSeg)
      const mid = typeof seg.material_id === 'string' ? seg.material_id : undefined
      if (!mid) continue
      const mat = audios.get(mid)
      if (!mat || mat.type === 'sound') continue
      const volume = typeof seg.volume === 'number' ? seg.volume : undefined
      if (volume === undefined || volume >= 1) continue
      const dur = typeof obj(seg.target_timerange).duration === 'number' ? (obj(seg.target_timerange).duration as number) : 0
      const prev = acc.get(mid)
      acc.set(mid, { dur: (prev?.dur ?? 0) + dur, volume })
    }
  }
  let bestId: string | undefined
  let best = { dur: -1, volume: 0 }
  for (const [mid, v] of Array.from(acc)) {
    if (v.dur > best.dur) { bestId = mid; best = v }
  }
  if (!bestId) return null
  const mat = audios.get(bestId) ?? {}
  const name = typeof mat.name === 'string' ? mat.name : ''
  const fileName = basename(mat.path)
  return { materialId: bestId, name, volume: best.volume, ...(fileName ? { fileName } : {}) }
}
```

改 `extractDraftMedia` 的 BGM 段：删掉「名字含歌曲不含提取」的循环，改为

```ts
  const picked = pickBgmSegment(draft)
  const bgm = picked?.fileName ? [{ fileName: picked.fileName, title: picked.name || picked.fileName }] : []
```

- [ ] **Step 5: 实现解析器加固（parseJianyingDraft.ts）**

1. `collectStickerSegs`：把 `if (track.type !== 'sticker') continue` 改为 `if (track.type !== 'sticker' && track.type !== 'text') continue`，并把函数名注释更新为「文字/贴纸轨」。
2. 开场动画判据：`/破镜|收拢/` 改为 `/破镜|收拢|玻璃|聚集|碎/`。
3. 音效判据：`openGear` 的 `/齿轮|旋钮/` 改为 `/齿轮|旋钮|鼠标|单击|点击/`；`transitionDrop` 的 `/水滴/` 保持。
4. BGM 音量：把整段「songCandidates…」逻辑替换为
```ts
      const picked = pickBgmSegment(draft)
      if (picked) bgmVolume = picked.volume
      else warnings.push('未找到有效 BGM 音量，回退默认 BGM 音量')
```
（`import { pickBgmSegment } from './draftMedia'`，注意 packages/db 内部相对 import 不带扩展名。`audioSegs` 仍用于 sfx 判定，保留。）
5. 水印：在 bookTitles 抽取之后加一块
```ts
  // 水印：文字里以 @ 开头的一行（如「@欧子好读」）→ 供导入时写进 overlayTemplate.watermark
  let watermark: string | undefined
  try {
    for (const t of Array.from(textsById.values())) {
      const line = t.text.trim()
      if (line.startsWith('@') && line.length > 1) { watermark = line; break }
    }
  } catch { warnings.push('水印解析失败') }
```
并在 `DraftMeta` 接口加 `watermark?: string`、`meta` 对象里加 `...(watermark ? { watermark } : {})`。

- [ ] **Step 6: 跑测试确认通过**

Run: Step 3 的命令 + 全量 `DATABASE_URL=... npx vitest run` + `npx tsc --noEmit -p worker/tsconfig.json`
Expected: 全绿、exit 0。**现有断言一处都不许改**——若旧测试红，说明判据改坏了，修实现不修测试。

- [ ] **Step 7: 提交**

```bash
git add packages/db/src/booklist/parseJianyingDraft.ts packages/db/src/booklist/draftMedia.ts packages/db/src/booklist/parseJianyingDraft.test.ts packages/db/src/booklist/draftMedia.test.ts
git commit -m "feat(jianying): 判据加固(文字轨text/sticker·BGM按音量·开场动画音效放宽·水印)"
```

---

### Task 2: 三段结构从主视频轨节奏提取

**Files:**
- Create: `packages/db/src/booklist/draftStructure.ts`
- Modify: `packages/db/src/index.ts`（导出）
- Modify: `packages/db/src/booklist/parseJianyingDraft.ts`（用结构结果覆盖 open/flash 参数）
- Test: `packages/db/src/booklist/draftStructure.test.ts`

**Interfaces:**
- Produces：
  ```ts
  export interface DraftStructure {
    openDurationMs: number      // 首段时长
    flashCount: number          // 快闪张数
    flashPerClipMs: number      // 快闪平均每张 ms（无快闪段时 0）
    flashMinClipMs: number      // 快闪最短 ms（无快闪段时 0）
    bodyCount: number           // 正片段数
    bodyAvgMs: number           // 正片平均段长 ms
    flashScale: number          // 快闪段 clip.scale.x 中位数（无则 1）
    bodyScale: number           // 正片段 clip.scale.x 中位数（无则 1）
    segments: { index: number; role: 'open' | 'flash' | 'body'; durationMs: number; scale: number }[]
  }
  export function extractDraftStructure(draft: unknown): DraftStructure
  ```
- Task 4/5 会消费 `segments`（按 role 过滤取正片段做运镜/缩放）。

- [ ] **Step 1: 写失败测试**

```ts
import { describe, it, expect } from 'vitest'
import { extractDraftStructure } from './draftStructure'

// 主视频轨 = attribute===1；1 开场 + 3 快闪 + 2 正片
const draft = {
  tracks: [
    { type: 'video', attribute: 0, segments: [{ material_id: 'x', target_timerange: { duration: 9_999_000 } }] }, // 装饰轨,须忽略
    { type: 'video', attribute: 1, segments: [
      { material_id: 'v0', target_timerange: { start: 0, duration: 1_500_000 }, clip: { scale: { x: 1 } } },
      { material_id: 'v1', target_timerange: { start: 1_500_000, duration: 100_000 }, clip: { scale: { x: 1.1 } } },
      { material_id: 'v2', target_timerange: { start: 1_600_000, duration: 133_000 }, clip: { scale: { x: 1.12 } } },
      { material_id: 'v3', target_timerange: { start: 1_733_000, duration: 100_000 }, clip: { scale: { x: 1.14 } } },
      { material_id: 'v4', target_timerange: { start: 1_833_000, duration: 6_067_000 }, clip: { scale: { x: 1.3 } } },
      { material_id: 'v5', target_timerange: { start: 7_900_000, duration: 7_033_000 }, clip: { scale: { x: 1.5 } } },
    ] },
  ],
}

describe('extractDraftStructure', () => {
  it('切出 开场/快闪/正片 三段并给出节奏', () => {
    const s = extractDraftStructure(draft)
    expect(s.openDurationMs).toBe(1500)
    expect(s.flashCount).toBe(3)
    expect(s.flashMinClipMs).toBe(100)
    expect(s.flashPerClipMs).toBe(111) // (100+133+100)/3 四舍五入
    expect(s.bodyCount).toBe(2)
    expect(s.bodyAvgMs).toBe(6550)    // (6067+7033)/2
  })
  it('缩放取各自中位数', () => {
    const s = extractDraftStructure(draft)
    expect(s.flashScale).toBeCloseTo(1.12, 3)
    expect(s.bodyScale).toBeCloseTo(1.4, 3)  // (1.3+1.5)/2 偶数取中间两值均值
  })
  it('标注每段角色', () => {
    expect(extractDraftStructure(draft).segments.map((x) => x.role)).toEqual(['open', 'flash', 'flash', 'flash', 'body', 'body'])
  })
  it('无快闪段（全长段）→ flash 计数为 0,其余段全归正片', () => {
    const s = extractDraftStructure({ tracks: [{ type: 'video', attribute: 1, segments: [
      { target_timerange: { duration: 2_000_000 } }, { target_timerange: { duration: 5_000_000 } },
    ] }] })
    expect(s.flashCount).toBe(0)
    expect(s.bodyCount).toBe(1)
    expect(s.openDurationMs).toBe(2000)
  })
  it('非法输入 → 全 0/1 不抛错', () => {
    const s = extractDraftStructure(null)
    expect(s).toEqual({ openDurationMs: 0, flashCount: 0, flashPerClipMs: 0, flashMinClipMs: 0, bodyCount: 0, bodyAvgMs: 0, flashScale: 1, bodyScale: 1, segments: [] })
  })
})
```

- [ ] **Step 2: 跑测试确认失败**（模块不存在）

- [ ] **Step 3: 实现 `draftStructure.ts`**

```ts
// 从主视频轨（attribute===1）的段落节奏切出 开场/快闪/正片 三段结构。
// 依据（双样本实测）：首段=开场；紧随其后连续 <500ms 的最长连跑=快闪；余下=正片。
// 比「靠《书名》文字段推快闪」稳——空白模板没有书名文字也能切对。

const FLASH_MAX_MS = 500

export interface DraftStructure {
  openDurationMs: number
  flashCount: number
  flashPerClipMs: number
  flashMinClipMs: number
  bodyCount: number
  bodyAvgMs: number
  flashScale: number
  bodyScale: number
  segments: { index: number; role: 'open' | 'flash' | 'body'; durationMs: number; scale: number }[]
}

function obj(x: unknown): Record<string, unknown> {
  return x && typeof x === 'object' && !Array.isArray(x) ? (x as Record<string, unknown>) : {}
}
function arr(x: unknown): unknown[] {
  return Array.isArray(x) ? x : []
}
function median(xs: number[]): number {
  if (xs.length === 0) return 1
  const s = [...xs].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}
function avg(xs: number[]): number {
  return xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : 0
}

const EMPTY: DraftStructure = {
  openDurationMs: 0, flashCount: 0, flashPerClipMs: 0, flashMinClipMs: 0,
  bodyCount: 0, bodyAvgMs: 0, flashScale: 1, bodyScale: 1, segments: [],
}

export function extractDraftStructure(draft: unknown): DraftStructure {
  const tracks = arr(obj(draft).tracks).map(obj)
  const main = tracks.find((t) => t.type === 'video' && t.attribute === 1) ?? tracks.find((t) => t.type === 'video')
  if (!main) return EMPTY
  const segs = arr(main.segments).map(obj).map((s) => {
    const tt = obj(s.target_timerange)
    const scale = obj(obj(s.clip).scale).x
    return {
      durationMs: typeof tt.duration === 'number' ? Math.round(tt.duration / 1000) : 0,
      scale: typeof scale === 'number' && scale > 0 ? scale : 1,
    }
  })
  if (segs.length === 0) return EMPTY

  // 首段=开场；从第 1 段起找最长的「连续短段」连跑=快闪；其余=正片
  let bestStart = -1, bestLen = 0
  let i = 1
  while (i < segs.length) {
    if (segs[i].durationMs > 0 && segs[i].durationMs < FLASH_MAX_MS) {
      let j = i
      while (j < segs.length && segs[j].durationMs > 0 && segs[j].durationMs < FLASH_MAX_MS) j++
      if (j - i > bestLen) { bestLen = j - i; bestStart = i }
      i = j
    } else i++
  }
  const roles: ('open' | 'flash' | 'body')[] = segs.map((_, k) =>
    k === 0 ? 'open' : bestLen > 0 && k >= bestStart && k < bestStart + bestLen ? 'flash' : 'body')

  const flashDurs = segs.filter((_, k) => roles[k] === 'flash').map((s) => s.durationMs)
  const bodyDurs = segs.filter((_, k) => roles[k] === 'body').map((s) => s.durationMs)
  return {
    openDurationMs: segs[0].durationMs,
    flashCount: flashDurs.length,
    flashPerClipMs: avg(flashDurs),
    flashMinClipMs: flashDurs.length ? Math.min(...flashDurs) : 0,
    bodyCount: bodyDurs.length,
    bodyAvgMs: avg(bodyDurs),
    flashScale: median(segs.filter((_, k) => roles[k] === 'flash').map((s) => s.scale)),
    bodyScale: median(segs.filter((_, k) => roles[k] === 'body').map((s) => s.scale)),
    segments: segs.map((s, k) => ({ index: k, role: roles[k], durationMs: s.durationMs, scale: s.scale })),
  }
}
```

`packages/db/src/index.ts` 追加（**不带扩展名**）：
```ts
export { extractDraftStructure } from './booklist/draftStructure'
export type { DraftStructure } from './booklist/draftStructure'
```

- [ ] **Step 4: 接进 parseJianyingDraft**

在 `parseJianyingDraft.ts` 里 `import { extractDraftStructure } from './draftStructure'`，在「书名快闪」块**之后**加：

```ts
  // 画面节奏优先：主视频轨切出的三段结构比「靠《书名》文字段」稳（空白模板没有书名也能切）。
  let structure = extractDraftStructure(draft)
  try {
    if (structure.openDurationMs > 0) openDurationMs = structure.openDurationMs
    if (structure.flashCount > 0) {
      flashPerClipMs = structure.flashPerClipMs
      flashMinClipMs = structure.flashMinClipMs
    }
  } catch { warnings.push('画面节奏结构解析失败') }
```
并在 `DraftMeta` 加 `structure: DraftStructure`、meta 对象里带上 `structure`（Task 8 页面报告要用）。

- [ ] **Step 5: 跑测试确认通过 + 回归**

Run: `DATABASE_URL=... npx vitest run` 全量 + `npx tsc --noEmit -p worker/tsconfig.json`
Expected: 全绿。若既有 parseJianyingDraft 测试因 open/flash 数值变化而红——**先判断**：结构提取给出的值若确实更准（来自画面节奏），可更新该断言并在提交信息里说明；否则修实现。

- [ ] **Step 6: 提交** `feat(jianying): 从主视频轨节奏切出开场/快闪/正片三段结构`

---

### Task 3: TemplateParams 扩展 + 调色提取

**Files:**
- Modify: `packages/db/src/booklist/templateParams.ts`
- Create: `packages/db/src/booklist/draftGrade.ts`
- Modify: `packages/db/src/index.ts`
- Modify: `packages/db/src/booklist/parseJianyingDraft.ts`（把 grade 填进 params）
- Test: `packages/db/src/booklist/draftGrade.test.ts`、`packages/db/src/booklist/templateParams.test.ts`（扩展）

**Interfaces:**
- Produces：
  ```ts
  // templateParams.ts
  export interface GradeParams { filterName: string; intensity: number; contrast: number; sharpen: boolean }
  // TemplateParams 新增可选字段：grade?: GradeParams
  // draftGrade.ts
  export function extractDraftGrade(draft: unknown): GradeParams | null
  ```
- Task 6（渲染调色）消费 `params.grade`。

- [ ] **Step 1: 写失败测试（draftGrade.test.ts）**

```ts
import { describe, it, expect } from 'vitest'
import { extractDraftGrade } from './draftGrade'

const draft = {
  materials: {
    effects: [
      { id: 'e1', name: '青橙', type: 'filter', value: 0.503 },
      { id: 'e2', name: '锐化', type: 'sharpen', value: 0 },
      { id: 'e3', name: '', type: 'contrast', value: -0.213836477987421 },
    ],
  },
}

describe('extractDraftGrade', () => {
  it('读出滤镜名/强度/对比度/锐化', () => {
    expect(extractDraftGrade(draft)).toEqual({ filterName: '青橙', intensity: 0.503, contrast: -0.2138, sharpen: true })
  })
  it('只有对比度、无滤镜 → filterName 空串', () => {
    expect(extractDraftGrade({ materials: { effects: [{ type: 'contrast', value: 0.5 }] } }))
      .toEqual({ filterName: '', intensity: 0, contrast: 0.5, sharpen: false })
  })
  it('无调色信息 → null', () => {
    expect(extractDraftGrade({ materials: { effects: [] } })).toBeNull()
    expect(extractDraftGrade(null)).toBeNull()
  })
})
```

- [ ] **Step 2: 写失败测试（templateParams.test.ts 追加）**

```ts
describe('grade 可选字段', () => {
  it('缺省 → grade 为 undefined,其余字段与既有默认一致', () => {
    const p = parseTemplateParams({})
    expect(p.grade).toBeUndefined()
    expect(p.body.subtitleColor).toBe(DEFAULT_PARAMS.body.subtitleColor)
  })
  it('合法 grade 原样保留并数值兜底', () => {
    expect(parseTemplateParams({ grade: { filterName: '青橙', intensity: 0.5, contrast: -0.2, sharpen: true } }).grade)
      .toEqual({ filterName: '青橙', intensity: 0.5, contrast: -0.2, sharpen: true })
  })
  it('非法 grade（非对象/字段类型错）→ 丢弃或字段回落', () => {
    expect(parseTemplateParams({ grade: 'x' }).grade).toBeUndefined()
    expect(parseTemplateParams({ grade: { filterName: 42, intensity: 'a', contrast: null, sharpen: 1 } }).grade)
      .toEqual({ filterName: '', intensity: 0, contrast: 0, sharpen: false })
  })
})
```

- [ ] **Step 3: 跑测试确认失败**

- [ ] **Step 4: 实现 `draftGrade.ts`**

```ts
// 从 materials.effects 提取调色配方：滤镜名+强度、对比度、锐化。
// 剪映滤镜是其自有查找表，拿不到；此处只如实记录名字与数值，近似渲染由 worker 侧的具名表决定。
import type { GradeParams } from './templateParams'

function obj(x: unknown): Record<string, unknown> {
  return x && typeof x === 'object' && !Array.isArray(x) ? (x as Record<string, unknown>) : {}
}
function arr(x: unknown): unknown[] {
  return Array.isArray(x) ? x : []
}
const r4 = (n: number) => Math.round(n * 10000) / 10000

export function extractDraftGrade(draft: unknown): GradeParams | null {
  const effects = arr(obj(obj(draft).materials).effects).map(obj)
  if (effects.length === 0) return null
  let filterName = ''
  let intensity = 0
  let contrast = 0
  let sharpen = false
  for (const e of effects) {
    const type = typeof e.type === 'string' ? e.type : ''
    const value = typeof e.value === 'number' && Number.isFinite(e.value) ? e.value : 0
    if (type === 'filter') {
      const name = typeof e.name === 'string' ? e.name.trim() : ''
      if (name && !filterName) { filterName = name; intensity = r4(value) }
    } else if (type === 'contrast') {
      contrast = r4(value)
    } else if (type === 'sharpen') {
      sharpen = true
    }
  }
  if (!filterName && contrast === 0 && !sharpen) return null
  return { filterName, intensity, contrast, sharpen }
}
```

`index.ts` 追加 `export { extractDraftGrade } from './booklist/draftGrade'`。

- [ ] **Step 5: 实现 templateParams 扩展**

`templateParams.ts`：

```ts
export interface GradeParams { filterName: string; intensity: number; contrast: number; sharpen: boolean }
```
`TemplateParams` 接口加 `grade?: GradeParams`。`parseTemplateParams` 返回对象末尾加：

```ts
    ...(r.grade && typeof r.grade === 'object' && !Array.isArray(r.grade)
      ? { grade: {
          filterName: str((r.grade as Record<string, unknown>).filterName, ''),
          intensity: num((r.grade as Record<string, unknown>).intensity, 0),
          contrast: num((r.grade as Record<string, unknown>).contrast, 0),
          sharpen: bool((r.grade as Record<string, unknown>).sharpen, false),
        } }
      : {}),
```
注意现有 `str()` 对空串会回落默认值——`str(x, '')` 传空默认即可得到 `''`。

`parseJianyingDraft.ts`：`import { extractDraftGrade } from './draftGrade'`，在 `built` 对象组装处加 `...(grade ? { grade } : {})`，其中 `const grade = extractDraftGrade(draft)` 包在 try/catch 里（失败推 warning）。

- [ ] **Step 6: 跑测试确认通过 + 全量回归 + tsc**

- [ ] **Step 7: 提交** `feat(jianying): TemplateParams 加 grade 字段并从草稿提取调色配方`

---

### Task 4: 运镜与缩放提取

**Files:**
- Create: `packages/db/src/booklist/draftMotion.ts`
- Modify: `packages/db/src/booklist/templateParams.ts`（`motion?` / `flash.scale?` / `body.photoScale?`）
- Modify: `packages/db/src/index.ts`、`packages/db/src/booklist/parseJianyingDraft.ts`
- Test: `packages/db/src/booklist/draftMotion.test.ts`、`templateParams.test.ts`（扩展）

**Interfaces:**
- Consumes：Task 2 的 `extractDraftStructure`（拿正片段下标）。
- Produces：
  ```ts
  export type MoveId = 'push-in' | 'pull-back' | 'pan-right' | 'pan-left' | 'drift-up' | 'tilt-settle'
  export function extractDraftMoves(draft: unknown): MoveId[]
  // TemplateParams 新增：motion?: { moves: MoveId[] }；flash.scale?: number；body.photoScale?: number
  ```
  `MoveId` 与 `worker/templates/booklist/motion.ts` 中同名类型的取值集合必须完全一致（Task 7 直接喂进去）。

- [ ] **Step 1: 写失败测试**

```ts
import { describe, it, expect } from 'vitest'
import { extractDraftMoves } from './draftMotion'

const kf = (prop: string, pts: [number, number][]) => ({
  property_type: prop,
  keyframe_list: pts.map(([t, v]) => ({ time_offset: t * 1000, values: [v] })),
})
const draft = {
  tracks: [{ type: 'video', attribute: 1, segments: [
    { target_timerange: { duration: 1_500_000 } },                                   // 开场,跳过
    { target_timerange: { duration: 7_033_000 }, common_keyframes: [kf('KFTypePositionX', [[0, 0], [7033, 0.125]])] },   // 右移
    { target_timerange: { duration: 6_000_000 }, common_keyframes: [kf('KFTypePositionX', [[0, 0.1], [6000, -0.05]])] }, // 左移
    { target_timerange: { duration: 6_000_000 }, common_keyframes: [kf('KFTypePositionY', [[0, 0], [6000, -0.08]])] },   // 上移(剪映 y 向上为负)
    { target_timerange: { duration: 6_000_000 }, common_keyframes: [kf('KFTypeScaleX', [[0, 1.0], [6000, 1.2]])] },      // 推近
    { target_timerange: { duration: 6_000_000 }, common_keyframes: [kf('KFTypeScaleY', [[0, 1.2], [6000, 1.0]])] },      // 拉远
    { target_timerange: { duration: 6_000_000 }, common_keyframes: [kf('KFTypePositionX', [[0, 0], [6000, 0.001]])] },   // 变化过小,不产出
    { target_timerange: { duration: 6_000_000 } },                                                                        // 无关键帧,不产出
  ] }],
}

describe('extractDraftMoves', () => {
  it('按段分类出运镜序列（跳过开场段与无显著变化的段）', () => {
    expect(extractDraftMoves(draft)).toEqual(['pan-right', 'pan-left', 'drift-up', 'push-in', 'pull-back'])
  })
  it('位移与缩放同时存在时取变化量更大的一项', () => {
    const d = { tracks: [{ type: 'video', attribute: 1, segments: [
      { target_timerange: { duration: 1000 } },
      { target_timerange: { duration: 6_000_000 }, common_keyframes: [
        kf('KFTypePositionX', [[0, 0], [6000, 0.03]]),
        kf('KFTypeScaleX', [[0, 1.0], [6000, 1.5]]),
      ] },
    ] }] }
    expect(extractDraftMoves(d)).toEqual(['push-in'])
  })
  it('非法输入 → 空数组', () => {
    expect(extractDraftMoves(null)).toEqual([])
    expect(extractDraftMoves({ tracks: [] })).toEqual([])
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

- [ ] **Step 3: 实现 `draftMotion.ts`**

```ts
// 从每段 common_keyframes 的首尾差值分类运镜。阈值 0.02（归一化坐标/缩放），低于此视为无运镜。
// 剪映 y 轴向上为负：Δy < 0 = 上移(drift-up)，Δy > 0 = 下沉(tilt-settle 近似)。

export type MoveId = 'push-in' | 'pull-back' | 'pan-right' | 'pan-left' | 'drift-up' | 'tilt-settle'

const EPS = 0.02

function obj(x: unknown): Record<string, unknown> {
  return x && typeof x === 'object' && !Array.isArray(x) ? (x as Record<string, unknown>) : {}
}
function arr(x: unknown): unknown[] {
  return Array.isArray(x) ? x : []
}

/** 取一条关键帧曲线的首尾值差；点数 < 2 或数据异常 → 0 */
function deltaOf(kfs: unknown[], props: string[]): number {
  for (const raw of kfs) {
    const k = obj(raw)
    const prop = typeof k.property_type === 'string' ? k.property_type : ''
    if (!props.includes(prop)) continue
    const pts = arr(k.keyframe_list).map(obj)
    if (pts.length < 2) continue
    const val = (p: Record<string, unknown>) => {
      const vs = arr(p.values)
      return typeof vs[0] === 'number' ? (vs[0] as number) : 0
    }
    return val(pts[pts.length - 1]) - val(pts[0])
  }
  return 0
}

export function extractDraftMoves(draft: unknown): MoveId[] {
  const tracks = arr(obj(draft).tracks).map(obj)
  const main = tracks.find((t) => t.type === 'video' && t.attribute === 1) ?? tracks.find((t) => t.type === 'video')
  if (!main) return []
  const segs = arr(main.segments).map(obj)
  const out: MoveId[] = []
  segs.forEach((s, i) => {
    if (i === 0) return // 开场段的动画另有开场特效负责
    const kfs = arr(s.common_keyframes)
    if (kfs.length === 0) return
    const dx = deltaOf(kfs, ['KFTypePositionX'])
    const dy = deltaOf(kfs, ['KFTypePositionY'])
    const dz = deltaOf(kfs, ['KFTypeScaleX', 'KFTypeScaleY'])
    const mags: [number, MoveId][] = [
      [Math.abs(dx), dx >= 0 ? 'pan-right' : 'pan-left'],
      [Math.abs(dy), dy < 0 ? 'drift-up' : 'tilt-settle'],
      [Math.abs(dz), dz >= 0 ? 'push-in' : 'pull-back'],
    ]
    mags.sort((a, b) => b[0] - a[0])
    if (mags[0][0] > EPS) out.push(mags[0][1])
  })
  return out
}
```

`index.ts` 追加 `export { extractDraftMoves } from './booklist/draftMotion'` + `export type { MoveId } from './booklist/draftMotion'`。

- [ ] **Step 4: templateParams 扩展 + 测试**

`TemplateParams`：`flash` 加 `scale?: number`；`body` 加 `photoScale?: number`；顶层加 `motion?: { moves: string[] }`。`parseTemplateParams` 里：

```ts
    // flash 内：
    ...(typeof flash.scale === 'number' && Number.isFinite(flash.scale) ? { scale: flash.scale } : {}),
    // body 内：
    ...(typeof body.photoScale === 'number' && Number.isFinite(body.photoScale) ? { photoScale: body.photoScale } : {}),
    // 顶层：
    ...(Array.isArray(obj(r.motion).moves)
      ? { motion: { moves: (obj(r.motion).moves as unknown[]).filter((x): x is string => typeof x === 'string' && !!x) } }
      : {}),
```

测试（templateParams.test.ts 追加）：缺省 → 三者 undefined；给合法值 → 原样；`motion.moves` 含非字符串 → 过滤掉；`flash.scale` 非数字 → 字段不存在。

- [ ] **Step 5: 接进 parseJianyingDraft**

`built` 组装：`flash` 里加 `...(structure.flashScale !== 1 ? { scale: structure.flashScale } : {})`；`body` 里加 `...(structure.bodyScale !== 1 ? { photoScale: structure.bodyScale } : {})`；顶层加 `...(moves.length ? { motion: { moves } } : {})`，`const moves = extractDraftMoves(draft)` 包 try/catch。

- [ ] **Step 6: 跑测试确认通过 + 全量回归 + tsc**

- [ ] **Step 7: 提交** `feat(jianying): 从关键帧提取逐段运镜与画面基准缩放`

---

### Task 5: 文字动画提取

**Files:**
- Create: `packages/db/src/booklist/draftTextAnim.ts`
- Modify: `packages/db/src/booklist/templateParams.ts`（`body.subtitleEntrance?`）
- Modify: `packages/db/src/index.ts`、`packages/db/src/booklist/parseJianyingDraft.ts`
- Test: `packages/db/src/booklist/draftTextAnim.test.ts`、`templateParams.test.ts`（扩展）

**Interfaces:**
- Produces：
  ```ts
  export type EntranceId = 'fade-up' | 'mask-reveal' | 'char-stagger' | 'slide-in'
  export function extractSubtitleEntrance(draft: unknown): EntranceId | null
  // TemplateParams：body.subtitleEntrance?: EntranceId
  ```
  取值集合必须与 `worker/templates/booklist/captionsAnim.ts` 的 `EntranceId` 完全一致。

- [ ] **Step 1: 写失败测试**

```ts
import { describe, it, expect } from 'vitest'
import { extractSubtitleEntrance } from './draftTextAnim'

function draftWith(animNames: string[]) {
  return {
    materials: {
      texts: animNames.map((_, i) => ({ id: `t${i}`, content: JSON.stringify({ text: `文字${i}` }) })),
      material_animations: animNames.map((n, i) => ({ id: `an${i}`, animations: [{ name: n, type: 'in', duration: 1_000_000 }] })),
    },
    tracks: [{ type: 'text', segments: animNames.map((_, i) => ({ material_id: `t${i}`, extra_material_refs: [`an${i}`], target_timerange: { duration: 1_000_000 } })) }],
  }
}

describe('extractSubtitleEntrance', () => {
  it('逐字放大 → char-stagger', () => { expect(extractSubtitleEntrance(draftWith(['逐字放大']))).toBe('char-stagger') })
  it('渐显 → fade-up', () => { expect(extractSubtitleEntrance(draftWith(['渐显']))).toBe('fade-up') })
  it('点开 → mask-reveal', () => { expect(extractSubtitleEntrance(draftWith(['点开']))).toBe('mask-reveal') })
  it('滑片滑动 → slide-in', () => { expect(extractSubtitleEntrance(draftWith(['滑片滑动']))).toBe('slide-in') })
  it('多个动画取出现次数最多者', () => {
    expect(extractSubtitleEntrance(draftWith(['渐显', '逐字放大', '逐字放大']))).toBe('char-stagger')
  })
  it('未知动画名/无动画 → null', () => {
    expect(extractSubtitleEntrance(draftWith(['波浪弹入']))).toBeNull()
    expect(extractSubtitleEntrance(draftWith([]))).toBeNull()
    expect(extractSubtitleEntrance(null)).toBeNull()
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

- [ ] **Step 3: 实现 `draftTextAnim.ts`**

```ts
// 剪映文字动画名 → 渲染层已有的字幕入场。只映射有对应关系的，其余不猜（返回 null 走轮换）。
export type EntranceId = 'fade-up' | 'mask-reveal' | 'char-stagger' | 'slide-in'

const RULES: [RegExp, EntranceId][] = [
  [/逐字/, 'char-stagger'],
  [/渐显|淡入/, 'fade-up'],
  [/点开|展开/, 'mask-reveal'],
  [/滑片|滑动|滑入/, 'slide-in'],
]

function obj(x: unknown): Record<string, unknown> {
  return x && typeof x === 'object' && !Array.isArray(x) ? (x as Record<string, unknown>) : {}
}
function arr(x: unknown): unknown[] {
  return Array.isArray(x) ? x : []
}

export function extractSubtitleEntrance(draft: unknown): EntranceId | null {
  const materials = obj(obj(draft).materials)
  const animsById = new Map<string, string[]>()
  for (const raw of arr(materials.material_animations)) {
    const ma = obj(raw)
    const id = typeof ma.id === 'string' ? ma.id : undefined
    if (!id) continue
    animsById.set(id, arr(ma.animations).map(obj).map((a) => (typeof a.name === 'string' ? a.name : '')).filter(Boolean))
  }
  const counts = new Map<EntranceId, number>()
  for (const rawTrack of arr(obj(draft).tracks)) {
    const track = obj(rawTrack)
    if (track.type !== 'text' && track.type !== 'sticker') continue
    for (const rawSeg of arr(track.segments)) {
      for (const ref of arr(obj(rawSeg).extra_material_refs)) {
        if (typeof ref !== 'string') continue
        for (const name of animsById.get(ref) ?? []) {
          for (const [re, id] of RULES) {
            if (re.test(name)) counts.set(id, (counts.get(id) ?? 0) + 1)
          }
        }
      }
    }
  }
  let best: EntranceId | null = null
  let bestN = 0
  for (const [id, n] of Array.from(counts)) {
    if (n > bestN) { best = id; bestN = n }
  }
  return best
}
```

`index.ts` 追加导出。`templateParams.ts`：`body` 加 `subtitleEntrance?: string`，`parseTemplateParams` 的 body 里加
```ts
    ...(typeof body.subtitleEntrance === 'string' && body.subtitleEntrance ? { subtitleEntrance: body.subtitleEntrance } : {}),
```
`parseJianyingDraft.ts`：`built.body` 里加 `...(entrance ? { subtitleEntrance: entrance } : {})`，`const entrance = extractSubtitleEntrance(draft)` 包 try/catch。

- [ ] **Step 4: 跑测试确认通过 + 全量回归 + tsc**

- [ ] **Step 5: 提交** `feat(jianying): 提取字幕入场动画映射`

---

### Task 6: 渲染层调色

**Files:**
- Create: `worker/templates/booklist/grade.ts`
- Modify: `worker/templates/booklist/indexHtml.ts`（注入调色 CSS）
- Test: `worker/templates/booklist/grade.test.ts`

**Interfaces:**
- Consumes：`TemplateParams['grade']`（Task 3）。
- Produces：`export function gradeCss(grade: GradeParams | undefined): string`——返回一段 CSS（无 grade 时返回空串）。

- [ ] **Step 1: 写失败测试**

```ts
import { describe, it, expect } from 'vitest'
import { gradeCss } from './grade'

describe('gradeCss', () => {
  it('无 grade → 空串（老框架零影响）', () => {
    expect(gradeCss(undefined)).toBe('')
  })
  it('具名滤镜「青橙」按强度插值，且叠乘草稿对比度', () => {
    const css = gradeCss({ filterName: '青橙', intensity: 0.5, contrast: -0.2, sharpen: false })
    expect(css).toContain('.scene .photo')
    expect(css).toContain('filter:')
    // 强度 0.5 → sepia 0.09 (满配方 0.18 的一半)
    expect(css).toContain('sepia(0.09)')
    // 对比度：满配方 1.12 插值到 1.06，再叠乘 (1 + -0.2)=0.8 → 0.848
    expect(css).toContain('contrast(0.848)')
  })
  it('未内置的滤镜名 → 只套对比度,不加偏色', () => {
    const css = gradeCss({ filterName: '不存在的滤镜', intensity: 1, contrast: 0.25, sharpen: false })
    expect(css).toContain('contrast(1.25)')
    expect(css).not.toContain('sepia')
    expect(css).not.toContain('hue-rotate')
  })
  it('全中性（无滤镜且对比度 0）→ 空串,不产生无意义的 filter', () => {
    expect(gradeCss({ filterName: '', intensity: 0, contrast: 0, sharpen: false })).toBe('')
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

- [ ] **Step 3: 实现 `grade.ts`**

```ts
// 剪映滤镜近似表 → CSS filter 函数链。静态字符串、无动画，seek-safe。
// 剪映滤镜是其自有查找表，拿不到；只对实测过的具名滤镜给近似配方，未知名只套对比度（见设计文档 §4）。
import type { GradeParams } from './templateParams.js'

interface Recipe { contrast: number; saturate: number; sepia: number; hueRotate: number }

// 满强度(intensity=1)配方；青橙=暖橙偏色+提饱和的电影感
const RECIPES: Record<string, Recipe> = {
  青橙: { contrast: 1.12, saturate: 1.25, sepia: 0.18, hueRotate: -10 },
}
const NEUTRAL: Recipe = { contrast: 1, saturate: 1, sepia: 0, hueRotate: 0 }

const lerp = (a: number, b: number, t: number) => a + (b - a) * t
const r3 = (n: number) => Math.round(n * 1000) / 1000

export function gradeCss(grade: GradeParams | undefined): string {
  if (!grade) return ''
  const recipe = RECIPES[grade.filterName]
  const t = Math.max(0, Math.min(1, grade.intensity))
  const r: Recipe = recipe
    ? {
        contrast: lerp(NEUTRAL.contrast, recipe.contrast, t),
        saturate: lerp(NEUTRAL.saturate, recipe.saturate, t),
        sepia: lerp(NEUTRAL.sepia, recipe.sepia, t),
        hueRotate: lerp(NEUTRAL.hueRotate, recipe.hueRotate, t),
      }
    : { ...NEUTRAL }
  // 草稿自带的对比度调整（-1..1）叠乘到滤镜之上
  const contrast = r3(r.contrast * (1 + grade.contrast))
  const fns: string[] = []
  if (contrast !== 1) fns.push(`contrast(${contrast})`)
  if (r3(r.saturate) !== 1) fns.push(`saturate(${r3(r.saturate)})`)
  if (r3(r.sepia) !== 0) fns.push(`sepia(${r3(r.sepia)})`)
  if (r3(r.hueRotate) !== 0) fns.push(`hue-rotate(${r3(r.hueRotate)}deg)`)
  if (fns.length === 0) return ''
  // 同时作用于正片画面与快闪书封，保证全片同一调性
  return `    .scene .photo, .flashcard .fc-cover { filter: ${fns.join(' ')}; }`
}
```

- [ ] **Step 4: 注入 indexHtml**

先确认 `worker/templates/booklist/templateParams.ts`（re-export shim）已把新类型透出——若没有，追加 `export type { GradeParams } from '@mixcut/db'`，否则 `grade.ts` 的 `import type { GradeParams } from './templateParams.js'` 编译不过。

`indexHtml.ts` 顶部 `import { gradeCss } from './grade.js'`（worker 内相对 import **带 `.js`**）。找到拼装 `<style>` 的位置（`rootVarsCss(preset)` 与 `baseCss(preset)` 拼接处），在其后追加 `gradeCss(p.grade)`（flash 分支；`p` 为该分支的 TemplateParams 变量名，按实际代码命名）。经典分支同理若有 `templateParams` 可用则一并注入，没有则跳过。

- [ ] **Step 5: 跑测试确认通过 + 回归**

Run: `DATABASE_URL=... npx vitest run worker/templates/booklist/` 全绿 + 全量 vitest + tsc。
**关键回归**：既有 `indexHtml.flash.test.ts` 快照/断言不得变化（无 grade 时 `gradeCss` 返回空串）。

- [ ] **Step 6: 提交** `feat(booklist): 渲染层调色(具名滤镜近似+对比度)`

---

### Task 7: 渲染层运镜序列、基准缩放、固定字幕入场

**Files:**
- Modify: `worker/templates/booklist/motion.ts`（`moveTweens` 加 baseScale 参数；`pickMove` 加序列覆盖）
- Modify: `worker/templates/booklist/captionsAnim.ts`（`pickEntrance` 加固定入场）
- Modify: `worker/templates/booklist/indexHtml.ts`（flash 分支接线）
- Test: `worker/templates/booklist/motion.test.ts`、`captionsAnim.test.ts`（扩展）

**Interfaces:**
- Consumes：`params.motion.moves`（Task 4）、`params.body.photoScale`（Task 4）、`params.body.subtitleEntrance`（Task 5）。
- Produces：
  ```ts
  export function moveTweens(move: MoveId, n: number, startMs: number, endMs: number, isLast: boolean, baseScale?: number): string
  export function pickMove(seqNo: number, offset: number, moves?: string[]): MoveId
  export function pickEntrance(capIndex: number, offset: number, fixed?: string): EntranceId
  ```
  **默认值必须保证零回归**：`baseScale` 默认 `1.07`（= 现有 1.035/1.105 的中点），`moves`/`fixed` 缺省时行为与现状完全一致。

- [ ] **Step 1: 写失败测试（motion.test.ts 追加）**

```ts
describe('baseScale 默认值保持现有输出逐字节一致', () => {
  it.each(['push-in', 'pull-back', 'pan-right', 'pan-left', 'drift-up', 'tilt-settle'] as const)('%s 不传 baseScale 与传 1.07 输出相同', (mv) => {
    expect(moveTweens(mv, 2, 1000, 5000, false)).toBe(moveTweens(mv, 2, 1000, 5000, false, 1.07))
  })
  it('push-in 默认仍是 1.035 → 1.105', () => {
    const s = moveTweens('push-in', 2, 1000, 5000, false)
    expect(s).toContain('scale: 1.035')
    expect(s).toContain('scale: 1.105')
  })
})

describe('baseScale 改变推拉基准', () => {
  it('baseScale 1.3 的 push-in 围绕 1.3 推', () => {
    const s = moveTweens('push-in', 2, 1000, 5000, false, 1.3)
    expect(s).toContain('scale: 1.265')
    expect(s).toContain('scale: 1.335')
  })
})

describe('pickMove 序列覆盖', () => {
  it('给了 moves 就按顺序循环取', () => {
    const moves = ['pan-right', 'push-in']
    expect(pickMove(0, 0, moves)).toBe('pan-right')
    expect(pickMove(1, 0, moves)).toBe('push-in')
    expect(pickMove(2, 0, moves)).toBe('pan-right')
  })
  it('moves 为空/未给 → 回落原轮换', () => {
    expect(pickMove(3, 1, [])).toBe(pickMove(3, 1))
    expect(pickMove(3, 1, undefined)).toBe(pickMove(3, 1))
  })
  it('moves 含非法值 → 跳过非法项', () => {
    expect(pickMove(0, 0, ['不存在', 'push-in'])).toBe('push-in')
  })
})
```

- [ ] **Step 2: 写失败测试（captionsAnim.test.ts 追加）**

```ts
describe('pickEntrance 固定入场', () => {
  it('给了合法 fixed 就恒定返回它', () => {
    expect(pickEntrance(0, 0, 'char-stagger')).toBe('char-stagger')
    expect(pickEntrance(7, 3, 'char-stagger')).toBe('char-stagger')
  })
  it('非法/未给 → 回落原轮换', () => {
    expect(pickEntrance(2, 1, 'nope')).toBe(pickEntrance(2, 1))
    expect(pickEntrance(2, 1)).toBe(pickEntrance(2, 1, undefined))
  })
})
```

- [ ] **Step 3: 跑测试确认失败**

- [ ] **Step 4: 实现 motion.ts**

```ts
export function pickMove(seqNo: number, offset: number, moves?: string[]): MoveId {
  const valid = (moves ?? []).filter((m): m is MoveId => (MOVES as string[]).includes(m))
  if (valid.length > 0) return valid[((seqNo % valid.length) + valid.length) % valid.length]
  return MOVES[(((seqNo + offset) % MOVES.length) + MOVES.length) % MOVES.length]
}
```

`moveTweens` 签名加 `baseScale = 1.07`，把六个 case 的字面量改成围绕 B 计算（`const B = baseScale`，`const r = (x: number) => Math.round(x * 1000) / 1000`）：

```ts
    case 'push-in':
      return t(`{ scale: ${r(B - 0.035)} }`, `scale: ${r(isLast ? B + 0.09 : B + 0.035)}`)
    case 'pull-back':
      return t(`{ scale: ${r(isLast ? B + 0.13 : B + 0.07)} }`, `scale: ${r(B - 0.03)}`)
    case 'pan-right':
      return t(`{ scale: ${r(B + 0.03)}, x: -24 }`, `x: 24`)
    case 'pan-left':
      return t(`{ scale: ${r(B + 0.03)}, x: 24 }`, `x: -24`)
    case 'drift-up':
      return t(`{ scale: ${r(B + 0.03)}, y: 24 }`, `y: -24`)
    case 'tilt-settle':
      return t(`{ scale: ${r(B + 0.05)}, rotation: -2 }`, `scale: ${r(B - 0.01)}, rotation: 0`)
```
（`pushTo` 变量随之删除。B=1.07 时六种输出与改动前逐字节一致——这是 Step 1 第一组测试要证明的。）

- [ ] **Step 5: 实现 captionsAnim.ts**

```ts
export function pickEntrance(capIndex: number, offset: number, fixed?: string): EntranceId {
  if (fixed && (ENTRANCES as string[]).includes(fixed)) return fixed as EntranceId
  return ENTRANCES[(((capIndex + offset) % ENTRANCES.length) + ENTRANCES.length) % ENTRANCES.length]
}
```

- [ ] **Step 6: 接线 indexHtml.ts（flash 分支）**

正片段运镜：把
```ts
      if (p.body.kenBurns === 'subtle') motionLines.push(moveTweens('push-in', n, s.startMs, s.endMs, i === segs.length - 1))
```
改为
```ts
      if (p.body.kenBurns === 'subtle') {
        // 剪映草稿提取到运镜序列时按顺序循环用（分镜数与原工程不一定一致，循环保节奏感）；否则维持原「轻推」
        const mv = p.motion?.moves?.length ? pickMove(i - 1, 0, p.motion.moves) : 'push-in'
        motionLines.push(moveTweens(mv, n, s.startMs, s.endMs, i === segs.length - 1, p.body.photoScale ?? 1.07))
      }
```
字幕入场：把 flash 分支的 `pickEntrance(capIdx - 1, offset)` 改为 `pickEntrance(capIdx - 1, offset, p.body.subtitleEntrance)`。

- [ ] **Step 7: 跑测试确认通过 + 回归**

Run: 全量 `DATABASE_URL=... npx vitest run` + `npx tsc --noEmit -p worker/tsconfig.json`
Expected: 全绿。既有 `indexHtml.flash.test.ts` / `motion.test.ts` 断言零改动。

- [ ] **Step 8: 提交** `feat(booklist): 运镜序列覆盖·基准缩放·固定字幕入场`

---

### Task 8: 前端加密回退与人话报告 + 导入落库（水印/建议分镜数）

**Files:**
- Modify: `web/app/admin/jianying/page.tsx`
- Modify: `web/app/api/admin/jianying/import/route.ts`
- Test: `web/app/api/admin/jianying/import/route.test.ts`（扩展）

**Interfaces:**
- Consumes：parse 响应 `{ templateParams, meta, media }`；`meta` 现含 `watermark?`、`structure`（Task 1/2）；`templateParams` 含 `grade`/`motion`/`flash.scale`/`body.photoScale`/`body.subtitleEntrance`。
- Produces：import 接口新增两个**可选** multipart 字段 `watermark`（字符串）与 `bodyCount`（数字字符串）；分别落到 `overlayTemplate.watermark` 与 `copyFramework.suggestedSegmentCount`。缺省时行为与现状一致。

- [ ] **Step 1: 实现加密工程回退**

`onFolderChange` 里找到 `draft_content.json` 之后、读取之前，加密判定与回退：

```ts
  // 新版剪映(约 6.5+，含 iOS 19.x)加密 draft_content.json（密文不以 { 开头）。
  // 同工程的 Timelines/<id>/template.json 是等价明文时间线，自动回退到它。
  async function readDraftText(files: File[], draftFile: File): Promise<string> {
    const head = await draftFile.slice(0, 1).text()
    if (head === '{') return draftFile.text()
    const plain = files.find((f) => {
      const rel = (f as File & { webkitRelativePath?: string }).webkitRelativePath ?? ''
      return f.name === 'template.json' && rel.includes('/Timelines/')
    })
    if (!plain) throw new Error('这个剪映工程是加密的，且没找到可用的明文时间线（Timelines/*/template.json）')
    return plain.text()
  }
```
调用处把 `const text = await draftFile.text()` 换成 `const text = await readDraftText(files, draftFile)`，并用 try/catch 把抛出的信息 `setParseErr((e as Error).message)`（保持既有"选错文件夹清空旧预览"的状态清理行为）。

- [ ] **Step 2: 实现人话报告**

在解析预览卡片里，用 `meta.structure` / `templateParams` 渲染一个「识别结果」清单（替换现有裸参数展示，但保留画布/时长/字体/警告区块）。每条一行，前缀 ✓ / ⚠ / ✗：

```tsx
type Row = { icon: '✓' | '⚠' | '✗'; label: string; text: string }
function buildReport(meta: DraftMeta, tp: TP): Row[] {
  const rows: Row[] = []
  const st = meta.structure
  if (st && st.bodyCount > 0) {
    rows.push({ icon: '✓', label: '结构', text: `开场 ${(st.openDurationMs / 1000).toFixed(1)}s · 快闪 ${st.flashCount} 张 @${st.flashMinClipMs}–${Math.max(st.flashMinClipMs, st.flashPerClipMs)}ms · 正片 ${st.bodyCount} 段（平均 ${(st.bodyAvgMs / 1000).toFixed(1)}s）` })
  }
  rows.push({ icon: '✓', label: '转场', text: `叠化 ${tp.transition.durationMs}ms` })
  // 曲名来自 parse 响应的 media.bgm[0].title（templateParams 只有音量）
  const song = media?.bgm?.[0]?.title
  rows.push({ icon: '✓', label: '配乐', text: `${song ? `《${song}》 ` : ''}音量 ${tp.audio.bgmVolume.toFixed(2)}` })
  const sfx: string[] = []
  if (tp.audio.sfx.openGear) sfx.push('开场音效')
  if (tp.audio.sfx.transitionDrop) sfx.push('转场水滴')
  if (sfx.length) rows.push({ icon: '✓', label: '音效', text: sfx.join('、') })
  if (meta.watermark) rows.push({ icon: '✓', label: '水印', text: meta.watermark })
  if (tp.grade) {
    const known = tp.grade.filterName === '青橙'
    rows.push({
      icon: known || !tp.grade.filterName ? '✓' : '⚠',
      label: '调色',
      text: `${tp.grade.filterName || '仅对比度'} 强度 ${tp.grade.intensity.toFixed(2)} · 对比度 ${tp.grade.contrast.toFixed(2)}`
        + (known || !tp.grade.filterName ? '' : '（该滤镜未内置，仅按对比度近似）')
        + (tp.grade.sharpen ? ' · 锐化（无法复刻）' : ''),
    })
  }
  if (tp.motion?.moves?.length) rows.push({ icon: '✓', label: '运镜', text: `${tp.motion.moves.length} 段有关键帧运镜，按顺序循环套用` })
  if (tp.body.subtitleEntrance) rows.push({ icon: '✓', label: '字幕入场', text: tp.body.subtitleEntrance })
  return rows
}
```
字体区块沿用现有「内置/需上传字体文件」两态，另加一行固定说明：`✗ 装饰图层/剪映内置商用字体/艺术蒙版——超出模板能力，未复刻`。

- [ ] **Step 3: 写失败测试（import/route.test.ts 追加）**

```ts
it('带 watermark/bodyCount → 落到 overlayTemplate.watermark 与 suggestedSegmentCount', async () => {
  const form = makeForm({ projectName: '导入测试工程3' })
  form.set('watermark', '@欧子好读')
  form.set('bodyCount', '4')
  const res = await call(form)
  expect(res.status).toBe(200)
  const j = await res.json()
  createdFw.push(j.id)
  const fw = await prisma.copyFramework.findUniqueOrThrow({ where: { id: j.id } })
  expect((fw.overlayTemplate as Record<string, unknown>).watermark).toBe('@欧子好读')
  expect(fw.suggestedSegmentCount).toBe(4)
})
it('不带这两个字段 → 与现状一致（不写入）', async () => {
  const res = await call(makeForm({ projectName: '导入测试工程4' }))
  const j = await res.json()
  createdFw.push(j.id)
  const fw = await prisma.copyFramework.findUniqueOrThrow({ where: { id: j.id } })
  expect((fw.overlayTemplate as Record<string, unknown>).watermark).toBeUndefined()
  expect(fw.suggestedSegmentCount).toBeNull()
})
```
（`makeForm`/`call`/`createdFw` 沿用该文件既有 helper；工程名换新的避免与既有用例的幂等断言互相干扰。）

- [ ] **Step 4: 跑测试确认失败**

- [ ] **Step 5: 实现 import 路由落库**

`import/route.ts` 在读取表单字段处加：
```ts
  const watermark = String(form.get('watermark') ?? '').trim()
  const bodyCountRaw = Number(String(form.get('bodyCount') ?? ''))
  const bodyCount = Number.isInteger(bodyCountRaw) && bodyCountRaw > 0 ? bodyCountRaw : null
```
`overlayTemplate` 组装处加 `if (watermark) overlayTemplate.watermark = watermark`；`prisma.copyFramework.create` 的 data 里加 `...(bodyCount ? { suggestedSegmentCount: bodyCount } : {})`。

前端 `importAll()` 的 FormData 里相应加：
```ts
    if (meta?.watermark) form.set('watermark', meta.watermark)
    if (meta?.structure?.bodyCount) form.set('bodyCount', String(meta.structure.bodyCount))
```

- [ ] **Step 6: 验证**

Run: `DATABASE_URL=... npx vitest run web/app/api/admin/jianying/import/route.test.ts`（全绿）+ `npm run build -w web`（成功）+ 全量 vitest 绿 + tsc exit 0。

- [ ] **Step 7: 提交** `feat(web): 加密工程明文回退·人话解析报告·水印与建议分镜数落库`

---

### Task 9: 终验 + 真样本验证 + 文档

**Files:**
- Modify: `README.md`、`docs/superpowers/specs/2026-08-06-jianying-deep-extraction-design.md`（状态改「已实现」）

- [ ] **Step 1: 真样本冒烟（只读，不入库）**

用 node 直接跑解析器对两个真实工程各解一次，确认无异常、输出符合设计文档 §1 的实测值：

```bash
npx tsx -e "
const { parseJianyingDraft } = require('./packages/db/src/booklist/parseJianyingDraft');
const fs=require('fs');
for (const p of ['今天分享的是/draft_content.json','/Users/lizhishaoniange/Desktop/破碎的模板(1)/Timelines/507B4FBA-DC09-4356-8573-8F88F04B0D5F/template.json']) {
  const r = parseJianyingDraft(JSON.parse(fs.readFileSync(p,'utf8')));
  console.log(p, JSON.stringify({ params: r.params, structure: r.meta.structure, watermark: r.meta.watermark, warnings: r.meta.warnings }, null, 1));
}"
```
Expected（新模板）：`open.durationMs≈1500`、`flash` 张数 13 / `perClipMs≈115` / `minClipMs=100`、`transition.durationMs≈467`、`audio.bgmVolume≈0.4425`、`grade={青橙,0.503,-0.2138,true}`、`motion.moves` 非空、`body.photoScale≈1.3`、`watermark='@欧子好读'`、`open.shatter=true`。
Expected（旧样例）：结构 1+9+3；`bgmVolume≈0.692`；不因本批改动而报新 warning。
**对不上就停下来报告，不要改测试凑数。**

- [ ] **Step 2: 终验**

```bash
DATABASE_URL=postgresql://mixcut:mixcut@localhost:55433/mixcut_test?schema=public npx vitest run
npx tsc --noEmit -p worker/tsconfig.json
npm run build -w web
```

- [ ] **Step 3: 更新文档**

README「剪映工程导入」条目补一句：支持新版加密工程（自动回退明文时间线），并提取调色/运镜/字幕入场/画面缩放。设计文档状态行改「已实现」。

- [ ] **Step 4: 提交** `docs: 剪映深度拆解说明`
