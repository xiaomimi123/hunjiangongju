# AI 选书：学员填一个书名即出差异化成片 设计

> 状态：已实现 · 2026-08-18 · 分支 feat/shudan-m1
> 目标：学员在框架库选一个模板、只填一个「选题（书名或主题）」，系统自动配齐**真实存在**的书目（书名+作者经查证）、生成**每次都不同**的文案与配图，模板保持不变。

> **⚠️ 产品形态已被后续设计推翻，仅存档参考——不要照本文档改代码。**
> 本文档「二、范围」里「一条视频的书目数 = 模板需要的本数，学员填 1 本，AI 配齐其余，全部进口播」的形态已被
> `docs/superpowers/specs/2026-08-18-single-book-mode-design.md`（口播只讲学员填的这一本）推翻。
> `select-books` 这一步骤本身、书库查证/沉淀链路、`variables.books` 的产出**都原样保留**，
> 但用途改变了：AI 配齐的 N 本现在**只供开场快闪书封使用**（学员那本固定排在末位、最后一张定格），
> **不再有任何一本陪衬书进入口播文案**——单本设计里新增的 `buildSingleBookPrompt` 只讲 `variables.themeBook`
> 这一本，`variables.books` 里的其余书名对 LLM 全程不可见。

---

## 一、触发与根因

用户反馈：「学员通过选定模板生成的视频一致性很强」。排查发现问题比"太像"更严重——**学员填的选题基本被忽略**。

`worker/src/gen/generateScript.ts` 有一条逻辑：`mode === 'subject'` 且框架 `overlayTemplate.books` 非空时，自动切换到 `books` 模式并采用**框架自带书目**。而框架自带书目来自剪映工程解析，是**原作者那条视频里的书**。

后果链：

| 学员做的 | 系统实际做的 |
|---|---|
| 填选题「被讨厌的勇气」 | 切到 books 模式，采用原作者书单 |
| 期望 AI 围绕该书写文案 | `buildScriptPrompt` 的 books 分支**完全不使用 `subject`**，提示词里没有学员的选题 |
| 期望画面显示自己的书 | `assignBooksToSegments` 用框架书目 → 画面《书名》头显示**原作者的书** |

同框架下所有学员的生成，因此书目相同、提示词相同（仅剩 LLM 采样随机性），配图由文案派生故也雷同。

补充确认：学员路径不会命中 `__defaultAssetFolder`（该预填只在运营页客户端做），学员始终走 AI 生图，因此**只要文案变，配图就会变**。

## 二、范围（已与用户确认）

- 一条视频的书目数 = 模板需要的本数，学员填 1 本/1 个主题，**AI 配齐其余**。
- 真实性保障 = **联网检索 + 书库兜底**（百炼 `enable_search`，已确认 OpenAI 兼容端点可顶层传参）。
- 同一本书被不同学员选中时，**出片必须不同**。

### 非目标
- 不做真实书封面（现有模板是「AI 无字底图 + 叠书名」；接图书封面接口是另一工程）。
- 不做学员端的书目人工确认步骤（学员要一键出片；改为生成后可见）。
- 不改模板/渲染层，不改现有运营手填书单的路径。

## 三、方案

### 3.1 拆掉框架书目顶替逻辑

`generateScript.ts` 中「未手填书单则采用框架 `overlayTemplate.books`」整段移除。框架自带书目的语义收敛为「原片信息，仅供参考展示」，不再作为新视频内容。任何未显式指定书单的生成，一律走 §3.2 的 AI 选书。

### 3.2 新增流水线步骤 `select-books`（在 `generate-script` 之前）

输入：`GenerationTask.subject`（学员填的书名/主题）+ 目标本数 N。
输出：把结果写回 `task.variables.books`，形如 `[{ title, author, points? }]`——**与运营手填书单同一形状**，因此下游（文案 books 模式、《书名》头分配、flash 书封）全部无需改动。

两条前置跳过规则（实现时补充，原样跳过、直接入队 `generate-script`，零回归）：

- **运营已手填书单**：`variables.books` 非空数组 → 本步骤不介入，原样透传。
- **`scriptMode` 为 `manual`/`imitate`**：此时 `subject` 是从学员粘贴文案里截出的片段，不是书名/主题；走 AI 选书只会浪费联网检索、且模型一旦误判会把文案碎片当真书写入书库，污染书库长期准确性。这两种模式下游本就不采用 `books`（见 `booksForAssign`），选书纯属浪费。

不满足以上两条时，才走选书流程：

1. **解析学员输入**：判断是具体书名还是主题。
2. **查书库**：`BookLibrary` 按书名精确命中 + 按主题标签精确匹配召回候选。库内书视为已验证，不再联网。
3. **联网补齐**：不足 N 本时，调用带 `enable_search` 的 LLM，要求返回真实存在的书目（书名+作者+一句要点）。
4. **验证与剔除**：对联网返回的书做一次独立校验调用（同样带检索），确认「该书存在且作者正确」；不通过的剔除。
5. **沉淀**：通过验证的新书写入 `BookLibrary`（幂等：书名+作者唯一）。
6. **兜底**：任一环节（书库查询、联网推荐、二次校验）异常都单独 try/catch 降级而非抛出；若最终仍不足 N 本，直接按实际收集到的本数生成（不做"主题相近"再检索，也不硬失败），极端情况下（联网全失败且书库无同主题候选）退化为只含学员输入这一本，并记 warning。

失败策略：整个 `select-books` 步骤**不得使 flash 模板崩坏**。任一环节异常 → 记 warning + 用学员输入本身作为唯一书目继续（保证至少有 1 本，画面与文案仍成立）。

### 3.3 每次都不一样

三个机制叠加，全部由 `genTaskId` 派生的稳定随机源驱动（同任务重跑结果一致，不同任务必然不同）：

1. **切入角度**：从固定角度池随机取一个写进文案提示词（金句式/故事式/痛点式/对比式/场景式）。
2. **书单组合**：候选书多于 N 时，按随机源抽不同子集与不同排序。
3. **采样随机度**：`llmComplete` 支持传 `temperature`，文案生成显式使用较高值（现状未传，走服务端默认）。

### 3.4 书库（新表 + 后台页）

```prisma
model BookLibrary {
  id        String   @id @default(uuid())
  title     String
  author    String
  theme     String?          // 主题标签,用于同主题召回
  points    String?          // 一句话要点,供文案提示词使用
  source    String   @default("ai")  // 'ai'(联网查证沉淀) | 'manual'(运营录入)
  createdAt DateTime @default(now()) @map("created_at")
  @@unique([title, author])
  @@map("book_library")
}
```

后台 `/admin/books`：列表 + 主题筛选 + 手动增删改。**这是错误纠正的兜底手段，不是可选项**——AI 编造无法 100% 杜绝，运营必须能删掉/改正错误条目。

### 3.5 目标本数 N 的来源

优先级：`framework.overlayTemplate.__bookCount` → 框架 `overlayTemplate.books.length`（老框架兼容）→ 默认 5。`resolveBookCount`（`packages/db/src/booklist/bookPick.ts`）按此优先级读取并 clamp 到 1..20。

`__bookCount` 的写入路径：`/admin/jianying` 页面解析剪映草稿后得到 `meta.structure.flashCount`（原工程里快闪书封的槽位数）；点「一键导入」时（`importAll()`，`web/app/admin/jianying/page.tsx`）若该值为正数，随 `watermark`/`bodyCount` 一起以 `flashCount` 表单字段提交；`POST /api/admin/jianying/import`（`web/app/api/admin/jianying/import/route.ts`）校验为正整数后写入新建框架的 `overlayTemplate.__bookCount`，非正数/非数字一律不写（不落 0/NaN）。该字段全程可选：缺省行为与写入前完全一致。运营仍可在框架编辑页手动改 `__bookCount`。

### 3.6 学员端改动（很小）

- 选题输入框提示改为引导填书名或主题。
- 任务详情页展示「本条视频选用的书目」（书名+作者），学员生成后能看到 AI 选了什么。

## 四、架构与改动面

```
packages/db/prisma/schema.prisma      ← 新增 BookLibrary + 迁移
packages/db/src/ai/llm.ts             ← llmComplete 支持 temperature / enableSearch(顶层传参)
packages/db/src/booklist/bookPick.ts  ← 新增：纯函数(输入解析/候选合并/随机子集/角度选取)
worker/src/gen/selectBooks.ts         ← 新增：select-books 步骤(LLM 检索+验证+沉淀+兜底)
worker/src/gen/index.ts               ← 注册 select-books 并置于 generate-script 之前
worker/src/gen/generateScript.ts      ← 移除框架书目顶替；提示词加「切入角度」；temperature
web/app/api/admin/books/route.ts      ← 书库增删改查(operator)
web/app/admin/books/page.tsx          ← 书库后台页
web/app/(student)/templates/page.tsx  ← 输入提示文案
web/app/(student)/works/[id]/page.tsx ← 展示选用书目
```

渲染层零改动：产出写进 `variables.books`，与既有手填书单同形状。

## 五、错误处理

- 联网检索不可用（模型不支持 / 配置未开）：跳过联网，仅用书库；书库也不足 → 用学员输入作为唯一书目，记 warning。
- LLM 返回非法 JSON / 书目为空：重试一次，仍失败走兜底，不使任务 FAILED。
- 书库写入冲突（同名同作者并发）：靠唯一约束幂等，冲突即视为已存在。
- mock 模式：`select-books` 返回固定夹具书目，不发网络请求（沿用本仓 mock 约定）。

## 六、测试

- 纯函数：输入解析、候选合并去重、随机子集在同 seed 下稳定/异 seed 下不同、角度选取分布。
- `selectBooks`：库内命中不联网、联网补齐、验证剔除、沉淀幂等、各级兜底、mock 模式。
- `generateScript`：框架书目不再顶替（同一框架 + 不同 subject → 提示词不同）；切入角度进入提示词。
- 书库接口：operator 鉴权、增删改、唯一约束冲突处理。
- 回归：现有全部测试绿；运营手填书单路径行为不变；渲染层输出不受影响。

## 七、风险与取舍

- **无法 100% 杜绝编造**：联网检索+二次校验+书库沉淀只能大幅降低。后台人工纠错是必需能力。
- **耗时与成本上升**：每次生成多若干次带检索的调用；书库命中后可跳过联网，用久转快。
- **书封面非真实封面**：真实性只覆盖书名/作者/文案。
- **主题召回质量**：首版按 `theme` 字符串标签做简单匹配，不引入向量检索；库大之后可能需要升级。
