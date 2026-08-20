# 图片槽位固定与逐槽配置 设计

> 状态：设计中 · 2026-08-20 · 分支 feat/image-slots
> 目标：正片图片数由草稿锁定，每个槽位可单独配置来源（AI 生图 / 素材库随机）与提示词。

---

## 一、需求

运营要求：**「框架里有几张图」必须是确定的，并且能单独对某一张图配提示词；前几张走 AI 精修，后面的从素材库随机取。」**

前提是图片位的数量和顺序固定。现状不固定——正片图片数等于文案句数，文案长短会让每条片子的图片数变化，「第 3 张图」在不同片子里对应不同位置，逐槽配置无从谈起。

## 二、现状（实测客户样例）

框架的图片位构成：

| 段 | 数量 | 来源 |
|---|---|---|
| 开场 | 1（原工程是视频素材，我们用 AI 图替代） | AI |
| 快闪书封 | 9（= `__bookCount`） | AI，按书名生成 |
| **正片** | **4**（781 / 5704 / 8065 / 6068 ms） | AI 或素材库，**数量随文案浮动** |

**管道已通一大半**（本设计的关键发现）：

- `web/app/api/admin/jianying/import/route.ts:141` 导入时已写 `suggestedSegmentCount = bodyCount`
- `worker/src/gen/generateScript.ts:409` 已读它作为 `segCount`
- 提示词里已有「分成 N 段」（`:129`、`:332`）

**唯一缺的是最后一步：生成完没有校验段数**。`validateScript` 只查行数上限与总字数，不查「是否恰好 N 段」。AI 给几段就是几段。

## 三、方案

### A 段数强约束（本设计的核心，也是唯一有风险的一块）

`generateScript` 在拿到文案后，把行数**规整成恰好 `segCount` 段**：

- **多了** → 从尾部相邻两段合并，直到等于 N（尾部通常是收束句，合并损失最小）
- **少了** → 取最长的一段，在最靠近中点的标点处切开，重复到等于 N
- 切分复用 `worker/src/gen/splitScript.ts` 既有的按标点切句逻辑，不新造

**为什么不靠重试**：现有的超预算重试是「让 AI 重写」，但段数不对是**结构问题**，重写不保证收敛，且每次重试都是一次 LLM 调用。规整是确定性的、零成本、必然成功。

**保留告警**：规整发生时记一条 provenance/warning，说明 AI 输出了 M 段、已规整为 N 段——不静默。

**灰度**：仅当框架带 `__imageSlots`（即走新形态）时强制规整；老框架维持现状，零回归。

### B 逐槽配置

存在 `overlayTemplate.__imageSlots`，与既有 `__templateParams` / `__draftTimeline` 并存：

```ts
interface ImageSlotConfig {
  /** 槽位数 = 草稿正片 photo 段数，导入时自动填 */
  count: number
  slots: {
    index: number                     // 0-based
    source: 'ai' | 'library'
    prompt?: string                   // source==='ai' 时的**主体**提示词；留空则回退 artScenes 场景池
    folder?: string                   // source==='library' 时限定素材文件夹；留空则全库
  }[]
}
```

- **画风仍来自框架的 `imageStylePrompt`**，逐槽 `prompt` 只负责「画什么」。两者拼接，与现有 `buildFreeArtPrompt` 的结构一致——这样改一次画风，所有槽位一起变，不用逐个改。
- 未配置的槽位（`slots` 里没有对应 index）→ 维持当前行为（AI + artScenes 场景池）。
- `count` 与实际生成段数不符时以 `count` 为准（A 已保证相等）。

### C 消费

`worker/src/gen/generateImage.ts`：

- 逐段查 `__imageSlots.slots[i]`
- `source==='library'` → 从素材库随机抽（复用已实现的 `pickAssetsForSegments` 确定性随机，按 `folder` 过滤）
- `source==='ai'` → `buildFreeArtPrompt(stylePrompt, slot.prompt ?? 场景池方向)`
- 无配置 → 现状

**书封不受影响**：9 张快闪书封是「按书名生成」，其「前后」按书排而非按位置，与本设计的位置槽位是两套东西。书封的成本问题由「按书缓存」单独解决（见 `docs/BACKLOG.md` P1）。

### D 后台

框架编辑页新增「图片槽位」区：显示 N 个槽位，每个可选来源、填提示词。

**降级方案**：框架页已有 `overlayTemplate` 原始 JSON 文本框，UI 未完成前运营可直接手填 `__imageSlots`。因此 UI 不阻塞功能可用。

## 四、改动面

```
packages/db/src/booklist/imageSlots.ts (新)    ← 契约 + 解析(脏项丢弃)
worker/src/gen/generateScript.ts               ← 段数规整
worker/src/gen/generateImage.ts                ← 逐槽消费
web/app/api/admin/jianying/import/route.ts     ← 导入时按草稿 photo 段数填 count
web/app/admin/frameworks/page.tsx              ← 槽位编辑 UI
```

不改渲染层、不改数据库（`__imageSlots` 落在既有 `overlayTemplate` Json）。

## 五、风险

- **段数规整会改变文案观感**：合并会让某段变长、切分会让某句被断开。这是「锁定图片数」的必然代价——要么图片数浮动、要么文案被规整，二者不可兼得。规整算法选择「尾部合并 / 最长段切分」是为了把损失放在感知最弱处，但不能消除。
- **仅覆盖正片槽位**：开场图与快闪书封不在本设计范围。
- **本设计不解决时间轴槽位对齐**：段的**时长**仍由 TTS 决定，只锁定**数量**。完整的时间轴对齐（时长也照抄草稿）仍在 BACKLOG P2，等 FFmpeg 迁移后做。
