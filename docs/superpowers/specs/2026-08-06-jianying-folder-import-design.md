# 剪映工程文件夹一键导入（媒体全套入库 + 生成联动）设计

> 状态：已实现 · 2026-08-06 · 分支 feat/shudan-m1
> 目标：「剪映模板」页从「手动翻出 draft_content.json 单文件上传」升级为「直接选整个剪映工程文件夹」；
> 系统自动找到总谱 json 解析存框架，并把工程里的 BGM、图片素材自动入库、关联到框架，
> 使「选框架 → 点生成」即产出 **原 BGM + 原素材 + 原节奏** 的同款视频。

---

## 一、背景与关系

2026-07-30 的「剪映工程复刻」设计已落地：确定性解析 `draft_content.json` → `TemplateParams` → 存框架，渲染层消费。但实际使用暴露两个问题（用户反馈）：

1. **入口摩擦**：剪映工程是一个文件夹（实测样例 `今天分享的是/` 共 64MB、几十个文件），运营不知道系统要哪个文件，得自己翻出 `draft_content.json`。
2. **复刻缺媒体**：原设计明确「不复用客户原始图/音频」。但素材库（2026-08-04 五件套）上线后，生成流程已支持「素材库优先」配图和指定 BGM——媒体复用的基础设施已齐，把工程包里的 BGM/图片自动入库能显著提高复刻度。

本设计是对 07-30 设计的**增量升级**：解析器不动，渲染不动；改上传形态、加媒体入库、加生成联动。07-30 的「不复用原始素材」非目标条款由本设计**废止**（配音仍不复用，生成时用新 TTS）。

## 二、范围（已与用户确认）

- 上传形态：**页面直接选文件夹**（`webkitdirectory`），不做 zip；原「粘贴 json」入口保留作兜底。
- 媒体入库：**全套自动**——BGM 入 BGM 库、图片轨素材入素材库，均按工程名建文件夹；幂等（重复导入不重复入库）。
- 风格范围：书单快闪类工程（现有 flash 模板能力内）；超出模板能力的剪映特效忽略，不承诺任意风格。

### 非目标
- 不复用配音/朗读音频（生成时用新 TTS）。
- 不入库实拍视频（素材库视频现阶段不参与生成，传了也用不上，直接不传）。
- 不做 zip 解压、不做任意风格通用渲染。

## 三、流程（两步上传，只传有用文件）

```
运营选择工程文件夹（浏览器本地持有全部文件引用，尚未上传）
   │ 前端在文件列表中找 draft_content.json；找不到 → 报错「这不是剪映工程文件夹」
   ▼
第 1 步：POST /api/admin/jianying/parse（现有接口，扩展响应）
   │ 服务器解析 → { params, meta, mediaWanted: { bgm: [{文件名, 曲名}], images: [文件名] } }
   │ mediaWanted 从 draft json 的轨道信息确定性判定（音乐轨→BGM；图片轨引用→素材），不猜扩展名
   ▼
第 2 步：POST /api/admin/jianying/import（新接口，multipart）
   │ 携带 params + 工程名 + 在文件夹中按文件名匹配到的媒体文件
   │ 服务器：BGM → BgmLibrary(name=曲名, folder=工程名)
   │        图片 → StockAsset(kind=image, folder=工程名)
   │        建框架（复用现有 save 逻辑）+ overlayTemplate.__defaultBgmId / __defaultAssetFolder
   ▼
页面摘要：框架已创建 ✓ · BGM 入库 n 首 ✓ · 素材入库 n 张 ✓ · 忽略 n 个无关文件
```

64MB 样例实际上传约 10–20MB（一首 BGM + 十几张图；12MB 实拍 mov、配音 mp3、剪映元数据 json 都不上传）。

## 四、媒体筛选规则（服务器端，依据 draft json 轨道信息）

| 工程内容 | 判定依据 | 去向 |
|---|---|---|
| BGM 音频 | 音乐轨（沿用现有解析器「歌曲」轨识别，排除「提取音乐」参考轨） | BgmLibrary |
| 图片素材 | 图片/视频轨上被引用的 png/jpg/jpeg/webp | StockAsset(kind=image) |
| 配音/朗读音频 | record/提取轨 | 忽略 |
| 实拍视频 mov/mp4 | 视频轨非图片素材 | 忽略 |
| 剪映元数据 | attachment_*.json、draft_meta_info.json 等 | 忽略 |

幂等规则：同 folder（工程名）下已存在同名 BGM/素材 → 跳过不重复入库，摘要中标注「已存在，复用」。

## 五、生成联动

1. **BGM 默认级联**（worker 一小改）：renderVisuals 选 BGM 顺序改为
   `variables.__bgmId`（运营手选，最高优先）→ **框架 overlayTemplate.__defaultBgmId**（本次新增，校验仍存在）→ 曲库随机（现状兜底）。
2. **配图来源预填**（web 一小改）：生成页选中带 `__defaultAssetFolder` 的框架时，「配图来源」自动预填「素材库优先 + 该工程文件夹」；运营可改回 AI。导入时把工程名写入 `overlayTemplate.__defaultAssetFolder`。

`__defaultBgmId` / `__defaultAssetFolder` 存于 `framework.overlayTemplate` 顶层（与既有 `books`、`watermark` 同层），不进 `__templateParams`（渲染契约不动，`parseTemplateParams` 无需感知）。

## 六、错误处理

- 文件夹里没有 `draft_content.json` → 前端直接报错，不发请求。
- json 损坏/非剪映格式 → 沿用现有解析器行为（不抛错，返回默认 + warnings），页面展示 warnings。
- mediaWanted 里的文件在文件夹中缺失（用户挪过文件）→ 照常导入其余部分，摘要提示「n 个媒体文件未找到，已跳过」。
- 上传中断/部分失败 → import 接口先全量校验再落盘（沿用素材库批量上传的 all-validate-before-any-write 模式）。
- 权限：两接口均 operator-only，沿用现有 `/api/admin/*` 鉴权。

## 七、测试

- 纯函数：mediaWanted 提取（音乐轨/图片轨/忽略项/文件名匹配），用实地样例夹具。
- import 接口：入库 + 框架创建 + `__defaultBgmId` 写入 + 幂等重导 + 越权 403 + 混合缺失文件。
- worker：BGM 级联三层优先级（手选 > 框架默认 > 随机）+ 陈旧 `__defaultBgmId`（BGM 已删）回退随机。
- web 预填：选中带默认素材文件夹的框架 → 表单状态预填。
- 回归：现有全部测试绿；`parseTemplateParams` / 渲染路径零改动。

## 八、上传体积与服务器限制

前端逐文件校验大小，单文件上限沿用素材库/BGM 上传的现有限制；总请求体积受 Next.js/Caddy 配置约束，实施时实测样例工程通过（约 10–20MB），若超限在计划中调整配置并记录。
