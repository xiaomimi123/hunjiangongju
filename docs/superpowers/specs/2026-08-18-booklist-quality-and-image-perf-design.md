# 选书质量修正 + 图片加载优化 设计

> 状态：设计定稿待评审 · 2026-08-18 · 分支 feat/shudan-m1
> 目标：修正线上首跑暴露的三个选书缺陷；并把图片加载从「每次全量下大图」改为「小图 + 长期缓存」。

---

## 一、触发：线上首跑的真实数据

学员填「被讨厌的勇气」，`variables.books` 实际产出：

```json
[
  { "title": "被讨厌的勇气", "author": "" },
  { "title": "活出生命的意义", "author": "维克多·E·弗兰克尔", "points": "…" },
  { "title": "自卑与超越", "author": "阿尔弗雷德·阿德勒", "points": "…" },
  { "title": "被讨厌的勇气：自我启发之父阿德勒的哲学课", "author": "岸见一郎、古贺史健", "points": "…" },
  { "title": "阿德勒心理学入门", "author": "岸见一郎", "points": "…" }
]
```

书库沉淀 4 条，`theme` 全部为 `被讨厌的勇气`。

**查证质量本身是达标的**：4 本 AI 补充书全部真实存在且作者正确。问题在别处。

## 二、问题与根因

### A1 学员自己填的书没有作者

`resolveStudentBook`（`worker/src/gen/selectBooks.ts`）对学员输入只做**一次**联网查证，任一环节失败或 `parseVerifiedAuthor` 取不到值，就静默返回 `{ title, author: '' }`。本次即命中该分支。

讽刺之处：AI 补充的书每本都经过「推荐 + 独立校验」两道，唯独**视频真正要讲的那本**校验最弱。整批终审曾指出这一不对称，控制端当时判为可延后——**从线上首跑结果看，该判断是错的**。

### A2 同一本书出现两次

《被讨厌的勇气》（学员短名，作者空）与《被讨厌的勇气：自我启发之父阿德勒的哲学课》（AI 全名，作者齐全）是同一本书，占掉 5 个位置中的 2 个。`dedupeBooks` 按 `规范化书名 + 作者` 精确比对，短名与全名不相等，故未拦截。

### A3 主题标签写成了学员原始输入

`upsertBook(..., theme: subject)`：`theme` 被赋成学员填的书名。后果是**书库沉淀无法跨选题复用**——下个学员填「自卑与超越」，`theme` 变成「自卑与超越」，本次已查证的 4 本一条也召回不到，又要重新联网。「越用越准越快」这一核心价值兑现不了。

### B1 图片接口无任何缓存头

`web/app/api/files/[...path]/route.ts` 不返回 `Cache-Control`/`ETag`/`Last-Modified`。生成图内容永不变化，却每次打开页面、每次刷新都完整重下。

### B2 原图当缩略图

生成图为 720×960 PNG，单张 1.4–1.9MB，一条 4 段任务约 5.2MB；页面用 `object-cover` 缩成小方块预览。素材库页同样直接用原图渲染 `h-32` 网格。

### B3（不在本批修复）静态直出

图片经 Next.js 路由 + 登录态校验返回，未走 Caddy 静态直出。收益相对小，且直接开放静态目录会绕过鉴权（素材/成片不应公开）。**本批不做**，待前两项落地后再评估。

## 三、方案

### A 侧

**A1 学员书作者兜底三级**：
1. 联网查证（现状）；失败或取不到作者时 **重试一次**（同一提示词，短超时）。
2. 仍无作者 → 在本次候选池里找**书名包含关系**的书（如全名版），取其作者与要点。
3. 仍无 → 保留 `author: ''`，但记 warning，且**不写入书库**（避免污染）。

**A2 去重加入包含关系**：新增纯函数 `isSameBook(a, b)`：规范化书名后，一方是另一方的**前缀**（分隔符限定为 `：:—-（(` 等副标题分隔符，避免「活着」误吞「活着之上」），且作者一致或其中一方为空 → 视为同一本。合并时**保留信息更全的一条**（有作者 > 无作者；有要点 > 无要点），并把学员那本的位置保持在第一。

**A3 主题独立成词**：查证学员书时同时要 LLM 给出一个 **2–6 字的主题词**（如「自我成长」「心理学」），用它作为 `theme` 写库与召回；取不到时回退当前行为（用 subject），不硬失败。

### B 侧

**B1 缓存头**：`/api/files/*` 增加
- `Cache-Control: private, no-cache`（**必须 `private`**：这些资源需登录才能访问，不可进共享缓存；**不能用 `immutable`/长 `max-age`**——见下方修正说明）
- `ETag`（由 `文件大小-mtimeMs` 派生）与 `Last-Modified`，并处理 `If-None-Match`/`If-Modified-Since` 返回 `304`。
- Range 分片响应（视频）沿用现有逻辑，同样带上校验头。
- **修正（fix round 1）**：最初设计写的是 `immutable` + 一年 `max-age`，并假设「重新生成单段图片时前端已带 `?t=` 时间戳（`edit/page.tsx`），旧缓存自然失效，immutable 是安全的」——**这个假设是错的**。`?t=` 破缓存只在 `web/app/admin/generate/[id]/edit/page.tsx` 这一个页面生效；其余所有消费方（`web/app/(student)/works/[id]/page.tsx` 学生详情页、学生首页/素材库、管理端任务详情页等，也就是**学员实际观看/下载视频的页面**）都用裸 URL 访问同一路径。而以下三条流程会在**同一 URL 原地覆盖文件**：
  1. `web/app/api/generate/[id]/segments/[segNo]/route.ts`（约 44-49 行）：手动换图，覆盖 `gen/<taskId>/<seqNo>.png`；
  2. `worker/src/gen/generateImage.ts`（约 90-92 行）：AI 重新生成图片，同样覆盖 `gen/<genTaskId>/<seqNo>.png`；
  3. `worker/src/gen/renderVideo.ts`（约 187 行）：reset-to-edit 后重新渲染，覆盖 `gen/<genTaskId>/final.mp4`。
  
  若声明 `immutable`，浏览器在换图/重新渲染后仍可能长期展示旧内容且刷新也无法感知，比本任务要修的「加载慢」更糟。因此最终实现改为 `private, no-cache`：允许浏览器缓存，但每次都必须带 `ETag`/`If-Modified-Since` 回源校验；未变化时命中 `304`（响应体极小，重复打开页面仍不必重下几 MB 的 PNG/MP4），一旦文件被覆盖则立即拿到新内容。放弃的只是「完全跳过往返请求」的收益，换来内容正确性。

**B2 缩略图**：
- 生成图落盘后，用 ffmpeg 同时产出 `<seq>.thumb.webp`（宽 360、等比、质量约 78，预计 30–60KB）。
- 素材库上传（`/api/admin/assets`）落盘时同样产出缩略图（web 容器已装 ffmpeg）。
- 数据形状：**不新增数据库字段**。缩略图 URL 由原图 URL 按约定推导（`x.png` → `x.thumb.webp`），前端优先请求缩略图、失败时回退原图（`onError` 换 src）。这样**旧任务零迁移**即可工作。
- 消费方：任务详情页、编辑页分镜网格、素材库网格用缩略图；点开看大图仍用原图。

**失败策略**：缩略图生成失败只记 warning，绝不影响主流程（图片本身已落盘，前端回退原图）。

## 四、架构与改动面

```
packages/db/src/booklist/bookPick.ts      ← 新增 isSameBook；dedupeBooks 改用它
worker/src/gen/selectBooks.ts             ← 学员书三级兜底；主题词；写库用主题词
worker/src/gen/generateImage.ts           ← 落盘后产出缩略图
worker/src/thumb.ts (新)                  ← ffmpeg 缩略图封装(worker)
web/lib/thumb.ts (新)                     ← 同上(web,素材上传用)
web/app/api/admin/assets/route.ts         ← 上传时产出缩略图
web/app/api/files/[...path]/route.ts      ← 缓存头 + 304
web/app/admin/generate/[id]/page.tsx      ← 网格用缩略图(回退原图)
web/app/admin/generate/[id]/edit/page.tsx ← 同上
web/app/admin/assets/page.tsx             ← 同上
```

不新增数据库字段、不改渲染层、不改模板参数。

## 五、错误处理

- ffmpeg 不存在/转码失败：记 warning，跳过缩略图；前端 `onError` 回退原图。
- 缩略图文件缺失（旧任务）：请求 404 → 前端回退原图。
- `If-None-Match` 头畸形：按未命中处理，返回完整内容。
- 学员书查证两次都失败：按 A1 第 2、3 级兜底，任务继续。

## 六、测试

- 纯函数：`isSameBook` 的前缀/分隔符/作者空值/误吞反例（「活着」vs「活着之上」必须判为不同书）；`dedupeBooks` 合并时保留信息更全者且学员书仍在首位。
- `selectBooks`：作者兜底三级各自触发；主题词取到/取不到；主题词用于写库与召回；学员书无作者时不写库。
- 缩略图：生成成功产出文件、失败不抛错、原图仍在。
- `/api/files`：首次 200 带 `ETag`/`Cache-Control: private,...`；带 `If-None-Match` 命中返回 304 且无响应体；Range 请求仍正确。
- 回归：现有全部测试绿；渲染层与模板参数输出不变。

## 七、风险与取舍

- **不用 `immutable`**：`/api/files/*` 服务的文件并非「写一次永不变」——手动换图（`segments/[segNo]/route.ts`）、AI 重新生成图片（`worker/src/gen/generateImage.ts`）、reset-to-edit 后重新渲染视频（`worker/src/gen/renderVideo.ts`）都会在同一 URL 原地覆盖文件，且只有 `edit/page.tsx` 一处消费方带 `?t=` 破缓存，学生端等其余消费方都是裸 URL。改用 `private, no-cache` 换取「始终校验、内容一变就能立即看到」，代价是保留一次网络往返（但命中未变化时是几乎零流量的 304），这是当前多处原地覆盖场景下更安全的取舍。
- **缩略图占用磁盘**：每张多约 30–60KB，量级远小于原图，可接受。
- **`private` 缓存**：CDN/共享缓存不会缓存这些图，符合鉴权要求；带宽收益来自浏览器本地缓存与体积下降，而非边缘缓存。
- **主题词质量**：由 LLM 给出，可能不稳定；不做强约束，取不到即回退，后台可人工改 `theme`。
