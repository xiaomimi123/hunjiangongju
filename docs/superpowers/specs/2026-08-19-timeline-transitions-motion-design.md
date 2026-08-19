# 逐边界转场 + 真实运镜曲线 设计（时间轴复刻 · 阶段 1）

> 状态：设计中 · 2026-08-19 · 分支 feat/timeline-transitions-motion
> 目标：把「转场」与「运镜」从近似值改为照抄草稿实测值，这是用户视觉上最快能感知到的一步。

---

## 一、触发与实测发现

阶段 0 已让保真度可量化。本阶段开始真正提升保真度。选它先做的理由：纯画面表现层，不改变 `bodyTimings` 的产生方式，风险最低、见效最快。

对真实样例 `今天分享的是/draft_content.json` 的实测，推翻了两处此前的判断：

### 发现 A：转场挂在「前一段」上，且**只有 3/13 个边界有转场**

转场素材通过 `segment.extra_material_refs` 挂在**转出的那一段**上（最后一段没有）：

| 边界 | 挂载段 | 转场 | 时长 |
|---|---|---|---|
| seg10 → seg11 | seg10 | 叠化 | 300ms |
| seg11 → seg12 | seg11 | 叠化 | 500ms |
| seg12 → seg13 | seg12 | 叠化 | 500ms |
| **其余 10 个边界（seg0→…→seg10，即整个快闪段）** | — | **无** | **硬切** |

现有代码只读 `materials.transitions[]` 的全局众数（500ms）套给所有边界，**既抹平了 300ms，也把原片的 10 个硬切变成了叠化**。后者影响远大于前者。

### 发现 B：快闪卡的淡入是我们凭空加的

原工程快闪段之间无转场素材、`material_animations` 里也只有 2 个具名动画（`破镜重圆` 1.7s、`收拢` 0.5s，均属开场），快闪卡**没有入场动画**，就是硬切。

而我们的 `flashCardsTweens`（`worker/templates/booklist/flashMontage.ts:42-53`）给每张卡做 `opacity 0→1` 的 **0.12 秒淡入**，`bounceIn` 为真时还叠 `scale 0.86→1` 的弹入。一张快闪卡只有 150–250ms，**0.12s 淡入占掉超过一半生命**——原片干脆利落，我们每张都糊一下。这是快闪节奏感丢失的直接原因。

更要命的是 `flash.bounceIn` **从未被解析**：`parseJianyingDraft.ts:490` 直接写 `DEFAULT_PARAMS.flash.bounceIn`（恒为 `true`），是个「看起来是提取结果、实际是硬编码」的字段。

### 发现 C：运镜只有缩放在动，没有平移和旋转

正片三段各有 5 条「有 2 个点」的属性轨，但实际取值：

| 段 | ScaleX/Y | Rotation | PositionX/Y | 时长 |
|---|---|---|---|---|
| seg11 | 1.0 → **1.107571** | 0 → 0 | 0 → 0 | 5703ms |
| seg12 | 1.0 → **1.082490** | 0 → 0 | 0 → 0 | 8064ms |
| seg13 | 1.0 → **1.105659** | 0 → 0 | 0 → 0 | 6067ms |

即**纯粹的缓慢推近，无平移、无旋转**。ScaleX 与 ScaleY 恒等（等比缩放）。

这更正了此前的两处说法：不是「49 个关键帧的曲线被压成一个词」（真正动画的只有 2 条、各 2 点、线性），也不是「旋转丢了」（**根本没有旋转可丢**）。真实损失只有一项：**精确幅度**——我们硬编码 1.07，原片是 1.1076/1.0825/1.1057。

关键帧 `time_offset` 从 33333μs（30fps 的一帧）起、到略早于段尾结束，可视为覆盖整段。

## 二、方案

### A 新增 `draftTransitions.ts`：逐边界转场

- 遍历主视频轨每段的 `extra_material_refs`，在 `materials.transitions[]` 里查得到即为「该段转出时有转场」，查不到即**硬切**。
- 产出 `DraftTransition[]`，长度 = 段数 - 1，每项 `{ boundaryIndex, sourceName, renderType, durationMs, mapped } | null`（`null` 表示硬切）。
- `JIANYING_TRANSITION_MAP`：`'叠化' → 'crossfade'` 起步，未命中的名字退化为 `'crossfade'` 且 `mapped: false`（记 provenance）。渲染器已有 5 种转场（`crossfade/wipe/shard/glide-push/blur-dissolve`，`motion.ts`），映射表可随遇到的工程逐步扩充。
- **硬切必须被表达为 `null` 而不是「时长 0 的叠化」**——两者在渲染层行为不同，前者是不生成 tween，后者仍会生成一个退化的 tween。

### B 新增 `draftKeyframes.ts`：真实运镜

- 只取 `keyframe_list.length === 2` 的属性轨（样例里 49 条属性轨中只有 5 条满足，其余 44 条是剪映给每个可调属性的单点占位）。
- **进一步过滤首尾值相同的轨**（如本例的 Rotation/PositionX/PositionY 全是 0→0）——记录它们只会让下游生成一堆无效果的 tween。
- 产出 `{ scaleFrom, scaleTo, rotationFrom, rotationTo, posXFrom, posXTo, posYFrom, posYTo } | null`，全为静止时返回 `null`。
- ScaleX 与 ScaleY 不等时（非等比缩放）取 X，并记一条 provenance 说明未逐轴复刻——渲染层的 `.photo` 用单一 `scale`，不支持分轴。

### C `draftTimeline.ts`：本阶段只填 `segments` 与 `transitions`

存入 `overlayTemplate.__draftTimeline`，与既有 `__templateParams` **并存**。老框架无此键 → 走原逻辑，零回归。

### D 渲染侧消费

**这是本阶段最需要说清楚的取舍**：本阶段**不改变分镜数的产生方式**（那是阶段 2），所以我们的正片段数与草稿的 3 段并不相等，「逐边界」无法 1:1 对应。处理方式分两类：

1. **快闪卡：能力已实现，但按产品决定不启用**（2026-08-19 更新）

   `flashCardsTweens` 已支持硬切（`flash.hardCut`，commit `e283f39`）。渲出淡入版与硬切版对比样片后，**用户选择保留淡入**。

   这是一个**明确偏离原片的产品取舍**：原工程那 9 个快闪边界确实是硬切，我们主动不复刻。理由是我们的快闪卡是 AI 生成书封，与原片的真实素材质感不同，硬切在我们这边观感未必更好。

   因此：
   - `flash.hardCut` **缺省 `false`**，保持 0.12s 淡入 + 弹入；能力保留，将来单个框架想要硬切可单独开。
   - **不做**「从草稿自动判定该硬切还是淡入」这条链路——那会让系统自动切到用户不要的效果。
   - **不把它记成保真度报告里的 `unsupported`**：`unsupported` 的语义是「我们做不到」，而这里是「做得到但选择不做」。混淆两者会让报告失真。此决定记录在本文档，代码注释里也要写明，避免后人看到差异又跑去「修复」它。
   - `flash.bounceIn` 从未被解析（恒为硬编码 `true`）这一事实仍然成立，但既然默认行为不变，本阶段**不改动它**，留待需要时处理。

2. **正片转场与运镜（只能近似）**：段数不等，按草稿序列**循环套用**（沿用 `pickMove` 已有的循环取用惯例，`motion.ts:7-11`）。比现在的「全片统一 500ms 叠化 + 硬编码 1.07」精确得多，但**不是精确复刻**——必须在 provenance 里如实记为近似，不能让保真度报告谎称已精确还原。阶段 2 槽位对齐后才能升级为真正的逐边界。

## 三、改动面

```
packages/db/src/booklist/draftTransitions.ts (新)
packages/db/src/booklist/draftKeyframes.ts (新)
packages/db/src/booklist/draftTimeline.ts (新)
packages/db/src/booklist/parseJianyingDraft.ts  ← 产出 __draftTimeline；bounceIn 改为真解析
worker/templates/booklist/flashMontage.ts       ← 硬切支持
worker/templates/booklist/motion.ts             ← 新增 keyframeTween（transTweens 签名已够用，不动）
worker/templates/booklist/indexHtml.ts          ← 消费 __draftTimeline
```

不改生成流水线（`worker/src/gen/*`）、不改数据库。

## 四、错误处理

- `__draftTimeline` 缺失（老框架）→ 全部走现有逻辑，零回归。
- 转场名不在映射表 → 退化 crossfade + `mapped:false` + provenance。
- 关键帧全静止 → `motion: null`，渲染层回退现有的内置轻推。
- 任一提取器抛错 → 该项为空、不影响其余，解析整体 never throw（沿用既有约定）。

## 五、测试

- `draftTransitions`：真实样例断言恰好 3 个边界有转场（时长 300/500/500）、其余 10 个为 `null`；转场挂在前一段的语义（seg10 的转场属于 seg10→seg11 边界）；最后一段无转场不越界。
- `draftKeyframes`：真实样例断言 seg11/12/13 的 scale 为 1.0→1.107571/1.082490/1.105659；断言 Rotation/Position 因首尾相同被过滤；单点占位轨被过滤。
- `flashCardsTweens`：硬切模式产出 `tl.set` 而非 `fromTo`；淡入模式与改动前**逐字节相同**（回归红线）。
- `keyframeTween`：给定实测数值产出正确的 GSAP tween。
- 回归：现有全部测试绿；无 `__draftTimeline` 的框架渲染输出与改动前逐字节相同。

## 六、风险与取舍

- **正片转场/运镜只能循环近似**，不是精确复刻，直到阶段 2 槽位对齐。必须在 provenance 里如实标注，否则保真度报告会自欺。
- **映射表覆盖面窄**：起步只有「叠化」。遇到别的转场一律退化 crossfade，且会如实记录。
- **快闪硬切可能「过于生硬」**：原片如此，但我们的快闪卡是 AI 生成的书封、观感未必与原片素材相同。上线后看真实成片，必要时保留一个可配开关。
