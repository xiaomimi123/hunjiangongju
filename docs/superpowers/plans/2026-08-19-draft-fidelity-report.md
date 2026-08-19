# 剪映草稿保真度报告 实施计划（阶段 0）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让运营看得见「这个框架里哪些参数是真提取、哪些是默认兜底、哪些明确没复刻」，并把这份认知持久化到框架上。

**Architecture:** 新增三态 `ProvenanceEntry`；解析器用一个 `note()` helper 同时写既有 warnings 与新的结构化条目；新增 `detectUnsupported(draft)` **只在草稿真实存在时**才报「未复刻」；报告随框架落库，后台列表加角标。

**Tech Stack:** TypeScript、vitest、Prisma、Next.js

设计文档：`docs/superpowers/specs/2026-08-19-draft-fidelity-report-design.md`

## Global Constraints

- 测试命令统一带库：`DATABASE_URL="postgresql://mixcut:mixcut@127.0.0.1:55433/mixcut_test?schema=public" npx vitest run <路径>`
- **禁止 `Math.random()`**
- 提交前用 **Python 按字节扫描**确认源码无裸 NUL 字节；**不要用 `grep $'\x00'`**（shell 里会退化成空模式匹配一切，是假阳性）
- **回归红线**：`DraftMeta.warnings` 的文案必须与改动前**逐字节相同**——解析预览页 `buildReport()` 依赖它，改了会静默破坏运营看到的报告
- 不改渲染层、不改生成流水线、不影响任何已有框架的出片行为
- 真实样例在仓库根目录 `今天分享的是/draft_content.json`（未跟踪目录，勿提交）
- 中文项目，注释与文档用中文
- 集成测试保留 `afterAll` 清理，共享测试库不得留孤儿数据

---

### Task 1: `draftProvenance.ts` —— 类型 + 检测器 + 报告构建

**Files:**
- Create: `packages/db/src/booklist/draftProvenance.ts`
- Test: `packages/db/src/booklist/draftProvenance.test.ts`
- Modify: `packages/db/src/index.ts`（导出新符号，沿用同目录既有导出风格）

**Interfaces (Produces):**
```ts
export type ProvenanceStatus = 'extracted' | 'defaulted' | 'unsupported'
export interface ProvenanceEntry { path: string; status: ProvenanceStatus; detail?: string }
export interface DraftFidelityReport {
  parsedAt: string
  summary: { extracted: number; defaulted: number; unsupported: number }
  entries: ProvenanceEntry[]
}
export function detectUnsupported(draft: unknown): ProvenanceEntry[]
export function buildFidelityReport(entries: ProvenanceEntry[], parsedAt: string): DraftFidelityReport
export function isFidelityReport(v: unknown): v is DraftFidelityReport
```

`parsedAt` 由调用方传入（**不要在函数里 `new Date()`**，纯函数才好测）。

- [ ] **Step 1: 写失败测试**

新建 `packages/db/src/booklist/draftProvenance.test.ts`。用真实样例驱动（文件不存在时 `it.skip`，不要让测试因样例缺失而红）：

```ts
import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'
import { detectUnsupported, buildFidelityReport, isFidelityReport } from './draftProvenance'

const SAMPLE = path.resolve(__dirname, '../../../../今天分享的是/draft_content.json')
const hasSample = fs.existsSync(SAMPLE)

describe('detectUnsupported —— 只报草稿里真实存在的不可复刻项', () => {
  it('空/畸形输入 → 空数组，不抛错', () => {
    expect(detectUnsupported(null)).toEqual([])
    expect(detectUnsupported({})).toEqual([])
    expect(detectUnsupported('not an object')).toEqual([])
    expect(detectUnsupported({ materials: null, tracks: 'x' })).toEqual([])
  })

  it('草稿没有特效轨/特效素材 → 不报（避免噪音）', () => {
    const paths = detectUnsupported({ materials: { video_effects: [], effects: [] }, tracks: [] }).map((e) => e.path)
    expect(paths).not.toContain('effectTrack')
    expect(paths).not.toContain('videoEffects')
  })

  it('有独立特效轨 → 报 effectTrack', () => {
    const d = { materials: {}, tracks: [{ type: 'effect', segments: [{}] }] }
    expect(detectUnsupported(d).map((e) => e.path)).toContain('effectTrack')
  })

  it('有 bloom 外发光 → 报 textGlow，且 detail 含条数', () => {
    const d = { materials: { effects: [{ type: 'bloom' }, { type: 'bloom' }, { type: 'filter' }] }, tracks: [] }
    const e = detectUnsupported(d).find((x) => x.path === 'textGlow')
    expect(e).toBeTruthy()
    expect(e!.detail).toContain('2')
  })

  it('转场时长只有一种 → 不报差异；有多种 → 报', () => {
    const one = { materials: { transitions: [{ duration: 500000 }, { duration: 500000 }] }, tracks: [] }
    expect(detectUnsupported(one).map((e) => e.path)).not.toContain('transition.perBoundary')
    const two = { materials: { transitions: [{ duration: 300000 }, { duration: 500000 }] }, tracks: [] }
    expect(detectUnsupported(two).map((e) => e.path)).toContain('transition.perBoundary')
  })

  it('踩点只有阈值、无真实时间戳 → 不报（样例即如此）', () => {
    const d = { materials: { beats: [{ type: 'beats', ai_beats: { melody_percents: [0.6] } }] }, tracks: [] }
    expect(detectUnsupported(d).map((e) => e.path)).not.toContain('beats')
  })

  it('所有条目 status 恒为 unsupported', () => {
    const d = { materials: { effects: [{ type: 'bloom' }] }, tracks: [{ type: 'effect', segments: [{}] }] }
    expect(detectUnsupported(d).every((e) => e.status === 'unsupported')).toBe(true)
  })
})

describe('detectUnsupported —— 真实样例', () => {
  it.skipIf(!hasSample)('检出特效轨/画面特效/外发光×11/视频素材段/转场时长两种，且不报踩点', () => {
    const draft = JSON.parse(fs.readFileSync(SAMPLE, 'utf8'))
    const paths = detectUnsupported(draft).map((e) => e.path)
    expect(paths).toContain('effectTrack')
    expect(paths).toContain('videoEffects')
    expect(paths).toContain('textGlow')
    expect(paths).toContain('videoSegment')
    expect(paths).toContain('transition.perBoundary')
    expect(paths).not.toContain('beats')
    const glow = detectUnsupported(draft).find((e) => e.path === 'textGlow')!
    expect(glow.detail).toContain('11')
  })
})

describe('buildFidelityReport / isFidelityReport', () => {
  it('summary 计数与 entries 一致', () => {
    const r = buildFidelityReport(
      [
        { path: 'a', status: 'extracted' },
        { path: 'b', status: 'defaulted' },
        { path: 'c', status: 'unsupported' },
        { path: 'd', status: 'extracted' },
      ],
      '2026-08-19T00:00:00.000Z',
    )
    expect(r.summary).toEqual({ extracted: 2, defaulted: 1, unsupported: 1 })
    expect(r.entries).toHaveLength(4)
    expect(r.parsedAt).toBe('2026-08-19T00:00:00.000Z')
  })

  it('isFidelityReport 认得合法结构、拒绝畸形', () => {
    const ok = buildFidelityReport([{ path: 'a', status: 'extracted' }], '2026-08-19T00:00:00.000Z')
    expect(isFidelityReport(ok)).toBe(true)
    expect(isFidelityReport(null)).toBe(false)
    expect(isFidelityReport({})).toBe(false)
    expect(isFidelityReport({ parsedAt: 'x', summary: {}, entries: 'no' })).toBe(false)
    expect(isFidelityReport({ ...ok, entries: [{ path: 'a', status: '乱写' }] })).toBe(false)
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `DATABASE_URL="postgresql://mixcut:mixcut@127.0.0.1:55433/mixcut_test?schema=public" npx vitest run packages/db/src/booklist/draftProvenance.test.ts`
Expected: FAIL —— 模块不存在

- [ ] **Step 3: 实现**

按上述接口实现 `draftProvenance.ts`。要点：

- **每个检测项独立 try/catch**，任一项抛错跳过该项、不影响其余，整体 never throw（沿用 `parseJianyingDraft.ts` 既有约定）。
- 检测项（判据见设计文档 §三B）：`effectTrack`、`videoEffects`、`textGlow`、`videoSegment`、`transition.perBoundary`、`text.style`（`style0.size`/`strokes` 存在或段 `clip.transform.x !== 0`）。
- **踩点检测**：只有当 `materials.beats[]` 里出现真实时间戳数组（如 `user_beats`/`ai_beats.beats` 这类**数组且非空**）才报；样例那种只有 `melody_percents` 阈值的**不报**。
- `detail` 里带上数量（如「11 处文字外发光未复刻」），便于运营判断严重程度。

- [ ] **Step 4: 跑测试确认通过**

Run: 同 Step 2
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add packages/db/src/booklist/draftProvenance.ts packages/db/src/booklist/draftProvenance.test.ts packages/db/src/index.ts
git commit -m "feat(draft): 新增保真度 provenance 类型与不可复刻项检测"
```

---

### Task 2: 解析器接入 `note()`（warnings 文案逐字不变）

**Files:**
- Modify: `packages/db/src/booklist/parseJianyingDraft.ts`
- Test: `packages/db/src/booklist/parseJianyingDraft.test.ts`（既有文件，追加）

**Interfaces:**
- Consumes: Task 1 的 `ProvenanceEntry` / `detectUnsupported`
- Produces: `DraftMeta` 新增 `provenance: ProvenanceEntry[]`（`warnings` 保持不变）

- [ ] **Step 1: 写失败测试**

在既有测试文件追加：

```ts
describe('parseJianyingDraft —— provenance', () => {
  it('meta.provenance 非空，且每条 warning 都有对应的 defaulted 条目', () => {
    // 用既有测试里的最小草稿夹具；断言 provenance 里 defaulted 条数 >= warnings 条数
  })

  it('真实样例：provenance 含 unsupported 条目（特效轨等）', () => {
    // it.skipIf(!hasSample)
  })

  it('回归红线：warnings 文案与改动前完全一致', () => {
    // 用既有夹具跑一遍，断言 warnings 数组逐项等于硬编码的期望文案
    // 期望值必须是**手写常量**，不能由被测代码算出来（否则是同义反复）
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `DATABASE_URL=... npx vitest run packages/db/src/booklist/parseJianyingDraft.test.ts`
Expected: FAIL —— `meta.provenance` 为 undefined

- [ ] **Step 3: 实现**

在 `parseJianyingDraft` 内部定义：

```ts
const provenance: ProvenanceEntry[] = []
const note = (path: string, status: ProvenanceStatus, detail?: string) => {
  provenance.push({ path, status, ...(detail ? { detail } : {}) })
  if (status === 'defaulted' && detail) warnings.push(detail)   // 文案逐字沿用原 warnings.push 的字符串
}
```

把既有约 20 处 `warnings.push('...')` 逐个改为 `note('<字段路径>', 'defaulted', '<原样的那句话>')`——**字符串一个字都不能改**。同时在成功提取的分支补 `note('<字段路径>', 'extracted')`。

最后合入 `detectUnsupported(draft)` 的结果，并把 `provenance` 挂到返回的 `meta` 上。

- [ ] **Step 4: 跑测试确认通过**

Run: `DATABASE_URL=... npx vitest run packages/db/src/booklist/` 与 `npx tsc --noEmit -p worker/tsconfig.json`
Expected: 全绿、exit 0

- [ ] **Step 5: 提交**

```bash
git add packages/db/src/booklist/parseJianyingDraft.ts packages/db/src/booklist/parseJianyingDraft.test.ts
git commit -m "feat(draft): 解析器记录结构化 provenance,warnings 文案保持不变"
```

---

### Task 3: 落库 + 后台展示 + 终验

**Files:**
- Modify: `packages/db/prisma/schema.prisma` + 新建迁移 `packages/db/prisma/migrations/20260819120000_add_draft_fidelity_report/migration.sql`
- Modify: `web/app/api/admin/jianying/import/route.ts`、`web/app/api/admin/jianying/save/route.ts`、`web/app/admin/jianying/page.tsx`（保存时回传报告）
- Modify: `web/app/admin/frameworks/page.tsx`
- Test: `web/app/api/admin/jianying/import/route.test.ts`（既有文件，追加）

- [ ] **Step 1: 写失败测试**

在既有 import 路由测试追加：导入后读回框架，断言 `draftFidelityReport` 非空、`summary` 三个计数存在、`entries` 是数组。

- [ ] **Step 2: 跑测试确认失败**

Expected: FAIL —— 字段不存在（Prisma 类型错误或值为 null）

- [ ] **Step 3: 实现**

1. `schema.prisma` 的 `CopyFramework` 加 `draftFidelityReport Json? @map("draft_fidelity_report")`（照搬同文件第 100 行 `degradedNote` 的可空列写法）。
2. 手写迁移 SQL：`ALTER TABLE "copy_frameworks" ADD COLUMN "draft_fidelity_report" JSONB;`（命名与目录风格照搬 `20260818120000_add_book_library`）。跑 `npx prisma generate`。
3. `import/route.ts`：解析草稿后用 `buildFidelityReport(meta.provenance, new Date().toISOString())` 生成并写入 `copyFramework.create`。
4. `save/route.ts`：body 额外接收可选 `fidelityReport`，**用 `isFidelityReport` 校验**，非法则丢弃（不硬失败）。
5. `jianying/page.tsx:222`：保存时把 parse 拿到的报告一并回传。
6. `frameworks/page.tsx`：在第 131-133 行 `degradedNote` 角标旁加「保真度 N/M」角标，`title` 展示明细。**必须标明「导入时快照」**，否则运营会误以为它反映框架当前状态。

- [ ] **Step 4: 全量验证**

```bash
DATABASE_URL="postgresql://mixcut:mixcut@127.0.0.1:55433/mixcut_test?schema=public" npx vitest run
npx tsc --noEmit -p worker/tsconfig.json
npm run build -w web      # 以 exit code 为准；"Dynamic server usage...cookies" 是本仓一贯提示，非失败
```

**已知偶发**：`web/app/api/admin/students/[id]/route.test.ts > 禁用最后一名可用运营 → 400` 是共享测试库串扰，已在 784c903 大幅缓解但未数学消除。若只有它红，复跑确认并在报告中如实注明，不得据此声称"全绿"。

裸 NUL 检查：
```bash
python3 - <<'EOF'
import subprocess
files=subprocess.run(['git','ls-files','-z'],capture_output=True).stdout.split(b'\0')
bad=[n.decode() for n in files if n and n.decode().endswith(('.ts','.tsx')) and b'\x00' in open(n.decode(),'rb').read()]
print("含裸NUL:", len(bad), bad)
EOF
```

- [ ] **Step 5: 真实样例冒烟**

写一次性脚本（放 `packages/db/src/booklist/` 下，跑完立即删除并确认 `git status` 干净），对真实样例跑 `parseJianyingDraft` → `buildFidelityReport`，**把完整报告 JSON 原文贴进报告**。核对：`unsupported` 条目里确实出现特效轨、水波纹、11 处外发光、视频素材段、转场时长两种；确实**没有**踩点条目。

- [ ] **Step 6: 更新文档并提交**

设计文档状态改「已实现」，补「实现与设计的差异」。

```bash
git add -A
git commit -m "feat(draft): 保真度报告落库与后台展示"
```
