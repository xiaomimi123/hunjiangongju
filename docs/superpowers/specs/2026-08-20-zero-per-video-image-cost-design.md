# 把每条片子的 AI 生图降到零 设计

> 状态：设计中 · 2026-08-20 · 分支 feat/zero-image-cost
> 目标：为「每天几千到上万条」的量级扫清生图瓶颈。每条片子的生图调用从 **12 次降到 0**。

---

## 一、触发

用户提出十几天内要达到每天几千至上万条、十几个模板。按现状折算：

| 每天 | AI 生图 | 渲染 CPU |
|---|---|---|
| 1,000 条 | 12,000 张 | 20 核 |
| 10,000 条 | **120,000 张** | **200 核** |

生图 12 张/条的构成：正片 3 张（AI 自由创作）+ 快闪书封 9 张（`generateImage.ts:112-130`，**无条件走 AI，不看 assetSource**）。

用户确认的新形态：**正片图从素材库挑**（素材由 AI 离线备料，提示词由运营填写），**书封由 AI 按书名生成**。

## 二、关键洞察：书封应该按书缓存，不是按片子生成

书封是「书名 + 作者 + 画风」的函数，**与哪条片子无关**。同一本《活着》出现在一千条片子里，封面应当是同一张。

所以书封不该每条片子重生，而应**按书缓存**：首次出现时生成一张，之后永久复用。

这不只是省钱——**本身就是更正确的行为**。同一本书在不同视频里封面不一样反而是缺陷。

稳定运行后，每条片子的生图次数为 **0**：正片从素材库随机抽、书封从缓存取，只有遇到全新的书才生一张。

## 三、方案

### A 正片配图：素材库随机抽取

现有 `pickAssetsForSegments`（`worker/src/gen/stockAssets.ts:5-11`）是「按顺序取前 N 张」：

```ts
result.push(i < assets.length ? assets[i] : null)   // 永远是第 1、2、3 张
```

素材库存 500 张也没用，每条片子都取同样那几张，一天几千条全长一个样。这个函数当初是给运营手动指定文件夹用的，不是为批量设计的。

改为按 `genTaskId` 派生的**确定性随机**抽取，复用仓库既有的 `pickSubset`（`packages/db/src/booklist/bookPick.ts`，FNV-1a + LCG + Fisher-Yates）：同任务重跑结果一致，不同任务必然不同，且**不用 `Math.random()`**（本仓硬约束）。

素材不足 N 张时：循环复用而非留空——留空会回退 AI 生图，正是我们要消灭的。

### B 书封：按「书名+作者+画风」缓存

新表：

```prisma
model BookCover {
  id        String   @id @default(uuid())
  title     String
  author    String
  styleKey  String   @map("style_key")   // 画风提示词的指纹（截断哈希），不同画风各存一张
  fileUrl   String   @map("file_url")
  createdAt DateTime @default(now()) @map("created_at")
  @@unique([title, author, styleKey])
  @@map("book_covers")
}
```

- 单独建表而不是挂 `BookLibrary`：封面取决于画风，十几个模板画风可能不同，一本书一张封面不够。
- `styleKey` 用画风提示词的哈希而非原文：提示词可能很长，且作为唯一键的一部分需要长度可控。
- 并发写入靠唯一约束幂等，照搬 `upsertBook`（`packages/db/src/booklist/bookLibrary.ts`）已验证的 P2002 捕获 + 回查写法——`upsert` 在 Prisma 里不是原子的。

生图流程改为：查缓存 → 命中则复制文件到本次任务目录；未命中则生成、落盘、写缓存。

**失败不阻断**：缓存查询或写入异常 → 降级为直接生成（即现状行为），只记 warning。

### C 素材库批量备料

运营填提示词 + 张数 + 目标文件夹 → 后台批量生成入库。

- 复用既有 `imageGenerate` 与 `StockAsset` 表（已有文件服务、缩略图、素材库管理页）。
- 逐张生成、逐张入库：中途失败不丢已生成的部分。
- 长耗时任务走 BullMQ 而非 HTTP 请求内同步跑——生成 500 张会远超任何合理的 HTTP 超时。

## 四、改动面

```
packages/db/prisma/schema.prisma + 迁移        ← BookCover 表
packages/db/src/booklist/bookCover.ts (新)     ← 缓存读写(含 P2002 幂等)
worker/src/gen/stockAssets.ts                  ← pickAssetsForSegments 改确定性随机
worker/src/gen/generateImage.ts                ← 书封走缓存;正片素材不足时循环复用
worker/src/gen/batchImages.ts (新)             ← 批量备料 job
web/app/api/admin/assets/batch/route.ts (新)   ← 触发批量备料
web/app/admin/assets/page.tsx                  ← 备料入口(提示词+张数+文件夹)
```

## 五、风险与取舍

- **同一本书封面固定**：这是有意为之（见 §二）。若将来要「同书多封面」，可在 `styleKey` 上再加变体位。
- **素材库撞图**：一万条片子共用一个素材库，库存不足会明显重复。建议单模板至少 500–1000 张；实际重复率取决于库存与日产量之比，上线后需观测。
- **备料的生图成本仍在**，只是从「每条都付」变成「一次性」。500 张的库 = 500 次生图，一次付清。
- **本设计不解决 TTS 量级**：每天一万条约 69 小时音频，取决于火山账号并发配额，非代码能解决，需运营提前确认。
