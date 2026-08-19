# 剪映草稿保真度报告 设计（时间轴复刻 · 阶段 0）

> 状态：设计中 · 2026-08-19 · 分支 feat/draft-fidelity-report
> 目标：让运营看得见「这个框架里哪些参数是真从草稿提取的、哪些是默认值兜底、哪些明确没复刻」，并把这份认知持久化。

---

## 一、触发

用户诉求是「上传剪映工程 → 完美复刻 → 只换文案/配图/BGM → 每天批量出几十条」。整体方案分五个阶段（见 `~/.claude/plans/snoopy-singing-pizza.md`），本设计是**阶段 0**。

先做这一步的理由：后续每个阶段都在提升保真度，但**现在没有任何办法量化「提升了多少」**。先把度量建起来，后面每加一个提取器都能看到数字变化；同时它本身就是对运营的诚实交代。

## 二、现状问题

1. **解析器知道自己丢了什么，但说完就忘**。`parseJianyingDraft.ts` 每个提取块都有 try/catch 并 `warnings.push(...)`（全文约 20 处），`DraftMeta.warnings` 随解析预览接口返回，`web/app/admin/jianying/page.tsx` 的 `buildReport()` 把它翻译成人话给运营看。但 `web/app/api/admin/jianying/import/route.ts:119-127` 建框架时**完全没有引用 `meta`**——保存的那一刻这份信息永久丢失。事后想查「这个框架当初哪些参数是猜的」，唯一办法是把草稿重新传一遍。

2. **「未复刻」的告知是硬编码的**。`page.tsx:394` 有一条固定文案「✗ 装饰图层/剪映内置商用字体/艺术蒙版——超出模板能力，未复刻」，**不管这份草稿到底用没用这些东西都照样显示**。反过来，草稿里真实存在但我们不支持的东西（如样例里的水波纹特效轨、11 处文字外发光）**一个字都不会提**。

3. **warnings 是扁平字符串**，看不出严重程度——「字体未在映射表中」（轻微）和「未找到转场素材，回退默认」（影响明显）混在同一个列表里。

## 三、方案

### A 三态 provenance

```ts
export type ProvenanceStatus = 'extracted' | 'defaulted' | 'unsupported'
export interface ProvenanceEntry {
  path: string          // 'transition.durationMs' | 'effectTrack' | 'text.fontSize'
  status: ProvenanceStatus
  detail?: string
}
```

- `extracted`：真从草稿读到了值。
- `defaulted`：草稿里有这个概念但没读到（或读失败），用了默认值兜底。
- `unsupported`：**草稿里确实存在、但我们的渲染器做不到**，明确未复刻。

第三态是本设计的重点——它是现在完全缺失的一类信息。

### B 只在真实存在时才报「未复刻」

新增 `detectUnsupported(draft)`：扫描草稿里我们已知无法复刻的结构，**存在才报，不存在不报**。与现在那条无条件显示的硬编码文案相反。首批检测项（依据样例实测）：

| 检测项 | 判据 | 样例中的量 |
|---|---|---|
| 独立特效轨 | `tracks[].type === 'effect'` 有段 | 1 条轨 1 段 |
| 画面特效素材 | `materials.video_effects` 非空 | 1 条「水波纹」 |
| 文字外发光 | `materials.effects[].type === 'bloom'` | 11 条 |
| 真实视频素材段 | 主视频轨引用 `materials.videos[].type === 'video'` | 1 段（开场 2158ms） |
| 逐边界转场差异 | `materials.transitions[].duration` 去重后 >1 种 | 300ms 与 500ms 两种，现取众数抹平 |
| 文字样式字段 | `texts[].content` 的 `style0` 里存在 `size`/`strokes`，或段 `clip.transform.x !== 0` | 全部存在 |
| 踩点数据 | `materials.beats[]` 里有真实时间戳 | **样例没有**（只有 `melody_percents` 阈值），故不报 |

最后一项体现原则：**没有的东西不要报**，否则报告本身就成了噪音。

### C 不破坏既有 warnings

`DraftMeta.warnings: string[]` 被解析预览页 `buildReport()` 消费，**保持原样不动**。新增 `DraftMeta.provenance: ProvenanceEntry[]` 并存。

解析器内部引入一个小 helper，一次调用同时写两处，避免两份信息各写各的而漂移：

```ts
function note(path: string, status: ProvenanceStatus, detail?: string)
```

既有的 `warnings.push('...')` 调用点逐个替换为 `note(...)`，warnings 的文案**逐字保持不变**（预览页的显示不能变），只是额外多记一条结构化条目。

### D 落库与展示

- `schema.prisma` 的 `CopyFramework` 新增 `draftFidelityReport Json?`，照搬同文件 `degradedNote`（第 100 行）的可空列先例，配一个迁移。
- `import/route.ts` 建框架时写入；`save/route.ts` 同理（两条导入路径都要，否则从「保存」进来的框架没有报告）。
- `web/app/admin/frameworks/page.tsx`：在既有 `degradedNote` 角标（第 131-133 行）旁加一个「保真度 N/M」角标，`title` 悬浮显示明细。复用同一套 UI 模式，不新造。

报告结构：

```ts
export interface DraftFidelityReport {
  parsedAt: string
  summary: { extracted: number; defaulted: number; unsupported: number }
  entries: ProvenanceEntry[]
}
```

## 四、改动面

```
packages/db/src/booklist/draftProvenance.ts (新)  ← 类型 + detectUnsupported + buildFidelityReport
packages/db/src/booklist/parseJianyingDraft.ts    ← note() helper；warnings 文案逐字不变
packages/db/prisma/schema.prisma + 迁移            ← CopyFramework.draftFidelityReport
web/app/api/admin/jianying/import/route.ts        ← 落库
web/app/api/admin/jianying/save/route.ts          ← 落库
web/app/admin/frameworks/page.tsx                 ← 保真度角标
```

不改渲染层、不改生成流水线、不影响任何已有框架的出片行为。

## 五、错误处理

- `detectUnsupported` 任一检测项抛错 → 跳过该项、不影响其余，绝不让解析失败（沿用本文件既有的「每块 try/catch、never throw」约定）。
- 老框架无 `draftFidelityReport` → 前端不显示角标，不显示「0%」之类的误导数字。
- 报告只在**导入时**生成一次，不随后续框架编辑更新——它描述的是「这份草稿被解析成什么样」，不是框架当前状态。这一点要在 UI 上写明「导入时快照」。

## 六、测试

- `detectUnsupported`：对真实样例 `今天分享的是/draft_content.json` 断言能检出特效轨/video_effects/bloom×11/视频素材段/转场时长两种；断言**不**报踩点（样例无真实时间戳）。
- 空草稿/畸形草稿 → 返回空数组，不抛错。
- `buildFidelityReport`：summary 计数与 entries 一致。
- `parseJianyingDraft`：**warnings 的文案与改动前逐字节相同**（回归红线）；provenance 非空且与 warnings 条数对应。
- 落库：导入后 `draftFidelityReport` 非空且结构正确；老框架不受影响。
- 回归：现有全部测试绿。

## 七、风险

- **报告只是「导入快照」**：运营手动改过框架参数后，报告不会更新，可能与现状不符。UI 必须写明，否则会误导。
- **检测项是白名单**：只报我们已知的不支持项。草稿里若有别的没想到的东西，仍会静默丢失——这个局限无法根除，只能随后续阶段逐项补充。
