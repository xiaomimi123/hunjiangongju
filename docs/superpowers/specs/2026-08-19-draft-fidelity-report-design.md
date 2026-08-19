# 剪映草稿保真度报告 设计（时间轴复刻 · 阶段 0）

> 状态：**已实现** · 2026-08-19 · 分支 feat/draft-fidelity-report
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
- `import/route.ts`：收到的是**原始草稿文件**，报告在服务端算，权威可信。
- `save/route.ts`：只收 `{ name, templateParams }`（见 `web/app/admin/jianying/page.tsx:222`），**服务端拿不到原始草稿、无法重算**。改为额外接收一个可选的 `fidelityReport`——它由 parse 接口在服务端算出、经前端原样回传。这是**客户端可篡改**的数据，但该接口已限运营、且报告纯属信息性展示（不参与任何渲染或计费决策），可以接受；落库前做形状校验，非法直接丢弃而不是硬失败。两条路径都要写，否则走「保存」进来的框架没有报告。
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

## 八、实现与设计的差异

三个任务（`bfebbb2`/`d839469` 起至 Task 3）落地后，与本文档设计有以下几处出入，逐条对照 git log 与实际 diff 核实：

1. **Task 2 第一轮把「键完全缺失」误记为 `extracted`，评审打回后修正**（`8b80149`，评审 Important #1/#2）：
   - `canvas_config`/`duration` 键完全缺失时，回退值恰好「看起来标准」（720×960 / 0），第一版据此判定为 `extracted`；实际应为 `defaulted`（没有该字段、只是回退值巧合合理）。修正为先判定键是否真实存在（类型是否为 `number`），缺失才回退判 `defaulted`。
   - 父级整体 `defaulted`（如 `audio`/`open`/`flash`/`body.subtitle*` 整块回退）时，子叶子字段（如 `audio.bgmVolume`、`open.durationMs`）原先「沉默缺席」——不出现在 `provenance` 里，导致提取率统计失真偏高。修正为父子各自都留一条 `defaulted` 记录，多个字段共用同一句 `detail` 时改用 `pushedDetails` 去重，`warnings` 里只出现一次（避免同一句提示重复刷屏），但 `provenance` 条数不受影响。
   - 这两处都不影响本任务（Task 3）的落库/展示逻辑本身，但直接决定了 Step 5 冒烟结果里 `summary.extracted=25`（若无此修正会更高、且掺杂假阳性）。

2. **设计文档「改动面」表遗漏了两个必需文件**，本任务实施中补上：
   - `web/app/api/admin/jianying/parse/route.ts`：设计只说「报告由 parse 接口在服务端算出」，但没把该文件列入改动面。实现中给它加了 `buildFidelityReport(meta.provenance, ...)` 调用，响应体新增 `fidelityReport` 字段，供前端持有并在保存时原样回传给 `save/route.ts`。
   - `web/app/api/frameworks/route.ts`（框架列表 GET）：`frameworks/page.tsx` 展示保真度角标依赖列表接口把 `draftFidelityReport` 字段透出，原 `select` 未包含该列，需要补充。

3. **`import/route.ts` 收到「原始草稿文件」这一前提，实际需要新增一条数据通路才能成立**：设计文档写「import/route.ts 收到的是原始草稿文件」，仿佛这是既有事实；实际勘察代码后发现，导入路由此前只收 `templateParams`（已解析好的结构化参数）等表单字段，**并不持有原始草稿文本**。为了让服务端能权威重算报告，Task 3 新增了一个可选表单字段 `draftJson`：
   - `web/app/admin/jianying/page.tsx` 的 `importAll()` 在提交表单时把解析阶段保留的 `raw`（草稿原文）一并设进 `draftJson`；
   - `import/route.ts` 收到后自行 `JSON.parse` + `parseJianyingDraft` + `buildFidelityReport`，得到权威报告再落库；
   - 字段缺失或解析失败时报告置 `null`，不影响导入本身（沿用「报告纯信息性展示，绝不能拖垮主流程」的既有口径），并补了对应的零回归测试。

4. **`保真度` 角标的悬浮明细未按「path → 中文标签映射表」实现**：设计文档没有强制要求这张映射表，只在补充的实施约束里提醒「如果做，`fontsNeeded.*` 这类把数据值拼进路径的条目要特判」。实现里选择了更简单也更稳妥的做法——直接复用 `ProvenanceEntry.detail`（`defaulted`/`unsupported` 条目在写入时已经带上了人话文案，如「未找到转场素材，回退默认转场时长」），跳过 `path` 本身，从根源上避开了「无法穷举、需要特判动态 path」的问题，也不存在「未识别路径」兜底展示的风险。
