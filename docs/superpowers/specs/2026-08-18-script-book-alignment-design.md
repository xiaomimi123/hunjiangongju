# 文案与画面对齐：书名头跟内容走 + 开场白呼应模板标题 设计

> 状态：已实现 · 2026-08-18 · 分支 feat/script-align
> 实现提交：60a7b88（parseBookMarkedLines）· a482a18（assignBooksToSegments 显式序号）· 94c9b74（提示词改造）· c6412a0（主流程接线）
> 目标：消除成片里「屏幕上的《书名》头与口播内容不是同一本」的错位；让快闪开场的 4 秒有对应旁白。

---

## 一、触发：一条真实成片的取证

用户反馈成片「语音文案和视频图片不一致」。取 `final.mp4`（38.01s、720×960）逐帧比对：

- 场景切换检测：快闪在 **4.03s** 结束，其后 6 个正片分镜。加开场共 **7 段**，书单 **5 本**。
- 屏幕上依次出现的 6 个《书名》头：被讨厌的勇气 → 活出生命的意义 → 自卑与超越 → 自卑与超越 → 被讨厌的勇气：自我启发之父阿德勒的哲学课 → 阿德勒心理学入门。
- 代入 `allocateBookIndexes(7, 5)` = `[0,0,1,2,2,3,4]`，正片段（第 1..6 段）得 `[0,1,2,2,3,4]` —— 与实际显示**逐项吻合**，确认书名头完全由位置均分决定。

错位实例：

| 口播/字幕 | 屏幕上的书名头 | 实际归属 |
|---|---|---|
| 「《活出生命的意义》说」「人永远能选择面对苦难的姿态」 | 《自卑与超越》 | 活出生命的意义 |
| 「《自卑与超越》讲」「所有成长都始于承认自己不够好」 | 《被讨厌的勇气：自我启发之父阿德勒的哲学课》 | 自卑与超越 |

已排除的其它嫌疑：`generateTts.ts` 是**逐段**合成、段窗口取自各段真实音频时长（`generateTts.ts:78-104`），音频与字幕在段级严格对齐，不是时间线问题。

## 二、根因

### A 书名头按位置均分，与文案内容无契约

`generateScript.ts:128` `allocateBookIndexes(segCount, bookCount)` = `floor(i × bookCount / segCount)`，纯按下标整除分块。

而 books 模式提示词（`generateScript.ts:97`）第 3 条原文是「**请依书目数量合理分配每本书的篇幅**」——每本书占几行由 LLM 自由决定。两侧没有任何约束把它们绑在一起，错位是必然而非偶发。

这条素材的写法是「《X》说」+ 金句，均分恰好把「《X》说」切到下一本的块首，所以整体呈现为「书名头比内容早换一本」。

### B 旁白缺开场白，与模板开场标题不呼应

两件事叠加：

1. `STYLE_RULES`（`generateScript.ts:69`）明令「开篇第一句直击情绪、给一个具体场景或画面，**不要先介绍书或说"今天推荐"**」——提示词主动禁止开场白。
2. 快闪模板把第 0 段整段吃掉且**不出字幕**（`indexHtml.ts` 正片字幕取 `segs.slice(1)`），第 0 段的画面是「开场标题 + 书封快闪」。

结果：LLM 写的那句情绪开场白被念出来却永远看不到；而画面上「今天分享的是」这个标题没有任何旁白与之呼应。

**注意**：补开场白**不修复 A**。两个缺陷互相独立。

### 非本设计范围

同一条片子里《被讨厌的勇气》与《被讨厌的勇气：自我启发之父阿德勒的哲学课》并存，是同书重复占位——已由 `isSameBook`/`dedupeBooks`（commit f6777a4）修复，仅尚未部署，与本设计无关。

## 三、方案

### A 让 LLM 自己标注每行归属哪本书

books 模式提示词改为要求逐行输出 `书序号|文案`，书序号即书单里的 1..N 编号；开场白行用 `0`。解析后用这组序号直接决定《书名》头，位置均分退为兜底。

**格式与解析**
- 行格式：`^\s*(\d+)\s*[|｜]\s*(.+)$`（半角 `|` 与全角 `｜` 都接受；LLM 中文输出常出全角）。
- **全有或全无**：仅当每一条非空行都匹配、且每个序号都落在 `0..N` 内时，才采用结构化结果；否则整体回退到现行 `allocateBookIndexes`，并记 warning。不做部分解析——半解析会产出比均分更难预料的错位。
- 序号 `0` → 该行无书名头（开场白）。序号 `k` → `books[k-1]`。
- **不强制单调**：LLM 若来回跳书，按其自身结构如实呈现（`bookRuns` 会把连续同名合并）。均分是「猜」，如实呈现是「跟」，后者永远不比前者差。

**与预算校验的耦合（关键）**

`validateScript`/`trimToBudget`（`packages/db/src/scriptPolicy.ts:5,18`）按字符数算预算。若带着 `1|` 前缀去校验，每行凭空多 2 个字符，会挤压真实文案预算并让重试循环误判超限。因此**必须先剥离标记再校验**：`llmComplete` → 解析出 `{bookIdx, text}[]` → 只把 `text[]` 交给 `validateScript`/`trimToBudget`。

`trimToBudget` 只从尾部整行丢弃且保持顺序，因此裁剪后按 `out.length` 截取序号数组即可保持配对。前提是解析阶段已保证每条 `text` 非空（正则 `.+` + trim），否则 `trimToBudget` 内部的 `.filter(Boolean)` 会让两个数组错位——这是必须由解析器守住的不变式。

**函数签名**
- 新增纯函数 `parseBookMarkedLines(lines: string[], bookCount: number): { bookIdx: number; text: string }[] | null`，返回 `null` 表示不可用、须回退。
- `assignBooksToSegments(lines, books, bookIdxs?)` 增加可选第三参：给定时用它，未给定时维持 `allocateBookIndexes`。旧调用点行为不变。

**只作用于 books 模式**：subject 模式（select-books 全线失败、书单为空时的兜底路径）本就没有书单可编号，不加书序号格式要求，也不做解析。开场白要求（§B）与模式无关，两种模式都加——它取决于模板是否吞掉第 0 段，而非是否有书单。

### B 开场白按模板标题写

`generateScript` 读 `framework.overlayTemplate.__templateParams` 经 `parseTemplateParams` 得到模板参数；**仅当 `mode === 'flash'`** 时（也只有这种模板会吞掉第 0 段），把 `open.titleText` 喂进提示词，并要求第一行是与之呼应的开场白、序号写 `0`。

**必须同时改 STYLE_RULES**：现行第 1 条「不要先介绍书或说"今天推荐"」与新要求正面冲突，给 LLM 两条打架的指令只会让输出不稳定。改为按模板条件切换：

- 有开场标题（flash）：「**开场白之后**的第一句直击情绪、给一个具体场景或画面」。
- 无开场标题：保持现状原文不变。

回归红线（**范围须精确**）：未传 `openTitleText` 时，`STYLE_RULES` 段落必须与今天**逐字节相同**。

这条红线**不覆盖** §A 的书序号格式要求——书名头错位与模板是不是 flash 无关（classic 模板同样按位置均分贴书名头），所以书序号格式对**所有 books 模式**生效，非 flash 框架的 books 模式提示词也会因此改变，这是本设计有意为之的行为变化。两者不可混为一谈。

**取舍**：第 0 段的配图由该行文案派生，开场白（「今天分享的是五本…」）比原先的情绪化场景句更抽象，生成的底图可能更平淡。风险可接受——该图只在开场碎裂动画里露约 2 秒，且随即被书封快闪盖住。

## 四、改动面

```
worker/src/gen/generateScript.ts   ← parseBookMarkedLines；提示词加书序号格式与开场白要求；
                                      STYLE_RULES 条件化；assignBooksToSegments 接受显式序号；
                                      主流程先剥标记再校验预算
```

不改渲染层、不改模板、不改数据库、不新增字段。`allocateBookIndexes` 保留为兜底路径，不删。

## 五、错误处理

- LLM 不按格式输出 → `parseBookMarkedLines` 返回 `null` → 回退位置均分（= 今天的行为），记 warning，不硬失败。
- 序号越界（如书单 5 本却出现 `7|`）→ 视为整体不可用，同上回退。
- 重试压缩循环：追加的压缩指令拼在 `basePrompt` 之后，格式要求仍在，无需额外处理。
- 框架无 `__templateParams` 或非 flash → 不加开场白要求，行为不变。

## 六、测试

- `parseBookMarkedLines`：全部合法 → 解析；任一行无标记 → `null`；全角 `｜`；序号越界 → `null`；序号 `0` → 无书名头；文案含 `|` 字符时只按首个分隔符切分。
- `assignBooksToSegments`：给定显式序号时按其分配；未给定时与今天一致；序号 0 → 该段无 `bookTitle`。
- `buildScriptPrompt`：传 `openTitleText` 时含开场白要求，且风格准则首条为「开场白之后…」而非「开篇第一句…」；不传时 `STYLE_RULES` 段落与今天逐字节相同（books 模式的书序号格式要求属有意变化，不在此红线内）。
- `generateScript` 集成：标记在预算校验前被剥离（构造一条「带标记会超预算、剥离后不超」的用例断言不触发重试）；不可解析时回退均分；开场白落在第 0 段。
- 回归：现有全部测试绿；非 flash 框架与 manual/imitate 模式行为不变。

## 七、风险

- **依赖 LLM 守格式**：不守就回退到今天的行为，不会更差；但也就修不好——需上线后看真实成片验证守规率。
- **书序号跳跃**：LLM 若在两本书之间来回跳，书名头会跟着来回切。如实呈现优于均分猜测，但可能观感突兀；先上线观察，不预先加平滑逻辑（YAGNI）。
- **某本书分到 0 行**：其书封仍在快闪里出现却全片不被谈及。属既有现象（均分同样可能），本设计不改变。

## 八、实现与设计的差异

对照 60a7b88/a482a18/94c9b74/c6412a0 四次提交的 diff，核心结构（`parseBookMarkedLines` 签名、`assignBooksToSegments` 第三参、剥标记再校验预算的顺序）与设计完全一致。以下是实现过程中暴露、但设计阶段未写明的点：

1. **`buildImitatePrompt` 是设计未预见的连带改动**。§B 把 `STYLE_RULES` 从常量改成 `styleRules(hasOpenTitle: boolean)` 函数（因为是否有开场白要切换风格准则第一条），而 `buildImitatePrompt` 内部原样引用 `STYLE_RULES`，签名一变就必须跟着改调用点（`styleRules(false)`）。设计的「改动面」「函数签名」两节都只提到 `buildScriptPrompt`/`parseBookMarkedLines`/`assignBooksToSegments`，未列出 `buildImitatePrompt`。仿写场景本身依旧不支持 `openTitleText` 参数，行为不变，只是签名跟着挪了个位置。
2. **books/subject 两分支都改用数组统一编号**。原实现里编号列表是手写的 `1. xxx` / `2. xxx` …；一旦要在中间插入条件项（books 分支插开场白要求、subject 分支插开场白要求），手写序号会在开场白开关不同的两种情况下产生错位的编号。实现改为先拼 `bookItems`/`subjectItems` 数组（含可选的开场白/角度项），再统一 `map((s, i) => \`${i+1}. ${s}\`)` 生成编号——这是为达成设计描述的效果（编号连续、无跳号）而在实现层面选的写法，设计文档未描述这层机制。
3. **书序号解析的触发条件比「books 模式」更窄一层**：主流程用 `bookCount > 0 && scriptMode === 'auto'` 才会调用 `parseBookMarkedLines`，即 `mode==='books'` 之外还要求 `scriptMode==='auto'`（排除 `imitate`）。设计 §A「只作用于 books 模式」讨论的是 `books`/`subject` 这个内容维度，未提及 `scriptMode`（`manual`/`imitate`/`auto`）这个入口维度的交叉；实际上 `imitate` 走的是 `buildImitatePrompt`，本就不会让 LLM 输出书序号标记，这条额外判断与设计意图一致，只是设计文档没写出这层交叉条件。
