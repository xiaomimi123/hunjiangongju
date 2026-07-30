# 剪映工程复刻（JianYing Draft → 模板学习器）设计

> 状态：设计定稿待评审 · 2026-07-30 · 分支 feat/shudan-m1
> 目标：运营上传客户的剪映草稿，系统**确定性解析** `draft_content.json` 抽取剪辑配方，
> 产出现有 `TemplateParams`（booklist-flash 契约），存为可复用模板；生成时套用到 AI 新图 + 火山配音，
> 做到"同款"排版/节奏/转场，而非「拆解」那种靠机器猜的近似。

---

## 一、背景与依据

客户产出的是**剪映草稿工程**（不是成片），`draft_content.json` 内含精确剪辑参数。已实地解析客户样例 `今天分享的是/draft_content.json`（720×960、24.6s、14 视频段、22 文字、3 叠化转场、破镜重圆开场、字由玄真字体、人声+BGM+音效）确认：所有复刻所需参数都可**确定性抽取**，无需推断。

现有 `worker/templates/booklist/templateParams.ts` 的 `TemplateParams` 结构，注释明示"P2 学习器产出同结构对象填 `framework.overlayTemplate.__templateParams`"——**本功能的输出契约即 `TemplateParams`**，生成流程（booklist-flash）已能消费，渲染层不改。

**取代关系**：主线从「拆解」(视频→ASR+视觉→框架，近似) 换为「剪映上传→解析→模板」(精确)。拆解入口隐藏、代码保留。

---

## 二、范围（已与用户确认）

- **一个草稿 = 一套可复用模板**：学到配方后套用不同书、批量出片；非每条视频一个草稿。
- **复刻粒度 = 剪辑配方**：结构/分镜节奏/转场/开场特效/字体排版/音效结构；套到 **AI 新生成图 + 火山配音**上，**不复用**客户原始图片/音频。
- **首版聚焦书单快闪类结构**（与客户样例一致）；其它类型草稿不保证。
- **拆解入口隐藏**（保留代码，可恢复），不硬删。

### 非目标
- 不还原客户原始素材（图/视频/人声）。
- 不做通用剪映草稿解析器（仅书单快闪配方所需字段）。
- 不解析关键帧级动画曲线（只取"有无 Ken-Burns / 破镜 / 叠化"这类开关+时长）。
- 不内嵌字体二进制（草稿只有字体名，见 §6 字体）。

---

## 三、架构（4 块）

```
运营后台「上传剪映草稿」
   │  (zip 或直接 draft_content.json)
   ▼
[1] 上传接口  →  解压/读取 draft_content.json
   ▼
[2] parseJianyingDraft(draftJson) ── 纯函数 ──►  TemplateParams + 元信息(书名/字体名/时长/校验)
   ▼
[3] 存为框架/模板  framework.overlayTemplate.__templateParams = TemplateParams (mode:'flash')
   ▼
[4] 生成时选此框架 → 现有 booklist-flash 流程消费 TemplateParams（不改渲染）
```

### 模块 1：上传接口（运营）
- `POST /api/admin/jianying/parse`（operator 鉴权、限流）：
  - 入参：上传的 `.zip`（内含 draft_content.json）或直接 `draft_content.json` 文本/文件。
  - 处理：若 zip，读取其中 `draft_content.json`（忽略素材文件，只要该 JSON）；`JSON.parse`；调用 `parseJianyingDraft`。
  - 返回：`{ templateParams, meta }`，`meta = { canvas:{w,h}, durationMs, segmentCount, fontsNeeded:string[], bookTitles:string[], warnings:string[] }`。
  - **不落库**（预览用）；确认后再走「保存为框架」。
- `POST /api/admin/jianying/save`：把上一步的 `templateParams` + 运营填的框架名 存为一条框架记录（`overlayTemplate.__templateParams = templateParams`，`mode:'flash'`）。复用现有框架表/发布逻辑。

### 模块 2：解析器 `parseJianyingDraft`（核心，纯函数，可单测）
文件：`worker/src/gen/jianying/parseDraft.ts`
签名：`parseJianyingDraft(draft: unknown): { params: TemplateParams; meta: DraftMeta }`

抽取映射（draft_content.json → TemplateParams，字段以客户样例为基准，缺失走 `DEFAULT_PARAMS`）：

| TemplateParams 字段 | 来源 | 规则 |
|---|---|---|
| `mode` | 固定 `'flash'` | 本功能只产 flash |
| `open.durationMs` | 开场标题 sticker 段 `target_timerange`（含 `破镜重圆` 动画的那段） | μs→ms（/1000 四舍五入） |
| `open.shatter` | `materials.material_animations` 是否含 `破镜重圆` | 有→true |
| `open.titleText` | 开场标题文字素材 `content` 解析出的纯文本 | 默认「今天分享的是」 |
| `open.sfx` | 开场附近是否有 SFX 音频段 | 有→true |
| `flash.perClipMs` | 书单快闪段：书名文字/封面段的平均 `target_timerange.duration` | μs→ms；无则默认 200 |
| `flash.minClipMs` | 同上取最小值 | 默认 120 |
| `flash.bounceIn` | 快闪文字是否带弹入动画 | 默认 true |
| `flash.titleFontFamily` | 书名文字素材字体名（如 字由玄真）→ 映射到内置 family key | 见 §6 |
| `transition.durationMs` | `materials.transitions` 里正片 `叠化` 的代表时长 | μs→ms；多值取众数/较大值 |
| `body.subtitleFontFamily` | 字幕文字素材字体名 → family key | 见 §6 |
| `body.subtitleColor` | 字幕文字 `text_color`/styles.fill 颜色 | RGB[0..1]→#hex；默认 #ffffff |
| `body.subtitlePosY` | 字幕 sticker 段 `clip.transform.y` | 剪映坐标(中心原点,-1..1)→归一化 0..1（`y_norm = 0.5 - transform.y/2`）；默认 0.78 |
| `body.kenBurns` | 视频段是否有缩放/位移动画 | 有→'subtle' 否→'off' |
| `audio.bgmVolume` | BGM 音频轨代表 `volume` | 默认 0.69 |
| `audio.sfx.openGear` | 是否有开场"齿轮"类 SFX 段 | 默认按样例 true |
| `audio.sfx.transitionDrop` | 是否有转场"水滴"类 SFX 段 | 默认 true |

`DraftMeta`：`{ canvas:{width,height}, durationMs, segmentCount, fontsNeeded:string[], bookTitles:string[], warnings:string[] }`。
- `fontsNeeded`：草稿引用的字体名去重列表（字由玄真、莫雪体…），供运营对照 `worker/templates/booklist/fonts/` 是否齐全。
- `bookTitles`：从文字素材中用《》正则抽出的书名（复用现有 extractBooks 思路），供预览。
- `warnings`：画布非 720×960、无 flash 结构、字体缺失等提示，不阻断。

**健壮性**：所有字段"取不到就回退 DEFAULT_PARAMS 对应值"，任何单字段解析异常降级为默认 + 一条 warning，绝不整体抛错（除非根本不是合法 JSON）。产出对象经现有 `parseTemplateParams` 再规整一遍（双保险）。

### 模块 3：存储
复用现有框架库：新建一条框架，`overlayTemplate.__templateParams = params`。无新表、无迁移。

### 模块 4：生成
无改动。运营选该框架 → renderVisuals/renderVideo 已按 `__templateParams` 走 booklist-flash。

---

## 四、前端（后台）
- `/admin` 侧栏：**隐藏「拆解」入口**（保留路由与代码，仅不在导航露出）；新增「**剪映模板**」入口。
- 「剪映模板」页：上传草稿 → 展示解析预览（画布/时长/分镜数/需要的字体/识别到的书名/warnings）+ 一个「保存为框架」按钮（填框架名）。

---

## 五、数据流与错误处理
- 上传非法 JSON / zip 内无 draft_content.json → 400 + 明确文案。
- 解析部分字段失败 → 降级默认 + `warnings`，仍返回可用 templateParams。
- 画布非 720×960 → warning（当前渲染固定竖屏，先提示不阻断）。
- 字体缺失 → warning 列出需补的 .ttf；渲染用近似字体不报错。

---

## 六、字体
剪映草稿只带**字体名/路径引用**（如 `text/.../字由玄真.ttf`），不含可用字体二进制。解析器抽出字体名 → `fontsNeeded`。真正"同款字形"需客户提供 `.ttf` 放入 `worker/templates/booklist/fonts/`（现有机制）。字体名→内置 family key 的映射维护一张小表（字由玄真→flash-title、莫雪体→subtitle…），未命中回退默认 family + warning。

---

## 七、测试
- `parseJianyingDraft`：用客户样例 `draft_content.json` 的**精简夹具**断言：mode=flash、open.durationMs≈2159、shatter=true、titleText=「今天分享的是」、transition.durationMs∈{300,500}、subtitleColor、subtitlePosY 换算、fontsNeeded 含「字由玄真」、bookTitles 非空。
- 降级：空对象/缺字段 → 全默认 + 不抛错；坐标换算纯函数单测；颜色 RGB→hex 单测。
- 接口：operator 鉴权；非法 JSON→400；解析成功返回 templateParams+meta 结构。
- 回归：现有 booklist-flash 渲染消费该 templateParams 不变。

## 八、全局约束
- 向后兼容：不改渲染/生成流程与 TemplateParams 结构；无数据库迁移；纯函数可单测；现有测试全绿。
- 解析器放 worker（Node）；接口在 web，若需共享解析逻辑则解析器置于可被 web 引用的位置（`packages/` 或 worker 导出），实现计划里定。

## 九、验收
- 上传客户 `今天分享的是` 草稿 → 预览出正确的 720×960/24.6s/分镜数/字由玄真/书名；保存为框架。
- 用该框架生成一条书单号 → 成片的开场/节奏/转场/字幕排版与客户风格一致（字体齐时"同款")。
- 「拆解」入口从导航消失、代码仍在。
- 全量测试绿。
