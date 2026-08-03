# 后台增强五件套设计(账号/素材库/画风/克隆音色/BGM管理)

> 状态:设计定稿待评审 · 2026-08-04 · 分支 feat/shudan-m1
> 五个相对独立的后台增强,一批做完。已与用户确认:账号=学员+运营;素材=生成时可选用(不够 AI 补);复刻=火山控制台克隆、系统只需支持克隆音色。

---

## F1 后台手动添加账号(学员+运营)

### 现状/问题
注册默认关闭(邀请制)后,后台**没有任何新建账号入口**(学员页只能重置密码/禁用/删除)→ 管理员加不了人。

### 设计
1. `POST /api/admin/students`(扩展现有路由):入参 `{ email, nickname?, password, role: 'student' | 'operator' }`;operator 鉴权;email 唯一校验(409);`assertPassword` 沿用;bcrypt 存哈希。
2. 学员页(`/admin/students`)加「**新增账号**」按钮 → 弹层:邮箱/昵称/密码/角色(默认学员)。
3. 建的是运营时,页面在学员列表上方加一小节「运营账号」(列表:邮箱/昵称/创建时间;支持禁用/重置密码,复用现有 `[id]` 接口——该接口去掉仅限 student 的隐式假设,但**不能操作自己**与最后一名运营防锁死:禁用/删除运营前检查非自身且 operator 数>1)。

### 测试
- 创建学员/运营成功;重复 email 409;弱密码 400;非 operator 403。
- 禁用最后一名运营 → 400;禁用自己 → 400。

---

## F2 素材库(空镜头/封面,批量上传,生成时选用)

### 设计
1. **表** `stock_assets`(新迁移,加表安全):`id / kind('image'|'video') / name / folder?(String) / fileUrl / createdAt`。
2. **上传** `POST /api/admin/assets`:multipart 多文件(`files[]`)+ 可选 `folder`;图片(jpg/png/webp)与视频(mp4/mov/webm)按扩展名分 kind;存 `/data/assets/<uuid>.<ext>`;逐文件建记录;返回成败清单。批量=一次请求多文件。
3. **管理页** `/admin/assets`(导航「运营」组加「素材库」):网格缩略(图片直接显示,视频显示占位+名字);按文件夹筛选;支持改名/改文件夹(PATCH)、删除(DELETE,连文件)。
4. **生成时选用**:生成表单加「配图来源」:`AI 生图(默认)` / `素材库优先`;选后者时可选文件夹。落 `variables.assetSource:'library'` + `variables.assetFolder?`。
5. **流水线**(generate-image):`assetSource==='library'` 时,取该文件夹(缺省全库)的**图片**素材按创建序循环分配给各分镜(复制到任务目录作为 seg 图),**素材不够的分镜回退 AI 生图**;书封仍走 AI(flash 书封含书名叠字逻辑,素材不适配)。
6. **边界(YAGNI)**:视频素材 v1 只入库/管理/下载,**不参与生成**(现渲染管线是图片+Ken-Burns;视频分镜是另一个工程,后续再做)。上传页注明。

### 测试
- 上传多文件建多记录、kind 判定;PATCH 改名/文件夹;DELETE 删文件+记录。
- 纯函数 `pickAssetsForSegments(assets, segCount)`:循环分配、不够补 null(null→AI 回退)。
- generate-image:library 模式有素材用素材、不够回退 AI(mock)。

---

## F3 生成图片风格 → 油画/梵高

### 现状
画风由框架 `imageStylePrompt` 控制(逐框架可改),没有预设、默认偏水彩插画。

### 设计
1. 框架编辑页(`/admin/frameworks`)画风输入框旁加**预设按钮**:`厚涂油画`/`梵高风`/`治愈插画`,点击填充推荐提示词(可再手改):
   - 厚涂油画:`厚涂油画质感,浓郁色彩,可见笔触,古典书卷氛围,无人物,静物/自然/动物`
   - 梵高风:`梵高后印象派风格,旋转笔触,厚重颜料肌理,鲜明蓝黄对比,星夜质感,无人物`
   - 治愈插画:`极简性冷淡治愈系艺术插画,动物自然静物,留白构图,无人物`
2. worker 生图 fallback 默认画风改为厚涂油画(替换现水彩默认,`generateImage`/`bookCoverPrompt` 的默认 style 常量)。
3. 不换模型(wan2.7-image 表现力足够,风格靠提示词;换模型属运维配置已支持)。

### 测试
- 默认 style 常量断言更新;预设点击填充(组件层可省,构建过即可)。

---

## F4 克隆音色支持(火山声音复刻 2.0)

### 前提(用户操作)
用户在火山「声音复刻 2.0」控制台用对标音频克隆 → 得音色 ID(`S_` 开头)。系统侧只需"能用"它。

### 设计
1. **路由**:`tts.ts` 火山分支——speaker 以 `S_` 开头(克隆音色)时,`X-Api-Resource-Id` 用 `seed-icl-2.0`(可被 `extra.cloneResourceId` 覆盖);否则维持 `cfg.model`(seed-tts-2.0)。克隆音色**不带** `context_texts`(复刻音色暂不支持语音指令,火山文档明示)。
2. **音色可后台添加(不改代码)**:tts 能力配置 `extra.customVoices`(JSON 数组 `[{id,label}]`,models 页提示文案说明格式)→ 新端点 `GET /api/tts/voices`(登录即可)返回 内置 TTS_VOICES + customVoices 合并清单;生成页音色选择器改为拉该端点(删硬编码镜像 TTS_VOICE_OPTIONS)。
3. **worker 校验放宽**:`readVoice` 接受 内置白名单 或 `/^S_[A-Za-z0-9_-]+$/`(克隆 id)或 customVoices 无法同步校验 → 规则改为:内置白名单命中,或形如合法音色 id(`/^[A-Za-z0-9_.-]{3,64}$/`)且来源于生成表单下拉(表单只出白名单+custom,注入面已由端点控制)。tts/preview 同步用合并清单校验。

### 测试
- `S_xxx` → resourceId seed-icl-2.0 且 body 无 context_texts;普通音色不变。
- voices 端点合并/去重;customVoices 缺省=仅内置。
- readVoice 新规则:白名单/克隆 id 过,乱串(空格/中文/超长)拒。

---

## F5 BGM 批量上传 + 改名 + 文件夹

### 现状
BGM 单文件上传,库表无 name/folder 字段,列表不可改。

### 设计
1. **迁移**:`bgm_library` 加列 `name?(String)`、`folder?(String)`(加列安全)。
2. **上传**:`POST /api/bgm` 支持 multipart 多文件(`files[]`,兼容旧单文件字段)+ 可选 `folder`;name 默认取文件名(去扩展名)。
3. **编辑**:`PATCH /api/bgm/[id]` 改 `name/folder/styleTag`;列表按文件夹分组展示,行内编辑名字/文件夹。
4. 生成选曲逻辑不变(styleTag 自动选曲不受影响)。

### 测试
- 多文件上传建多记录、name 取文件名;PATCH 改名/文件夹;迁移幂等。

---

## 全局约束
- 迁移仅两条加法(`stock_assets` 建表、`bgm_library` 加列),`migrate deploy` 幂等。
- 渲染管线除 generate-image 的素材分配外不动;TemplateParams 不动。
- 纯函数可单测(pickAssetsForSegments/voice 校验/克隆路由判定);现有测试全绿。
- 视频素材不参与生成(v1 边界,页面注明)。

## 验收
- 后台能新建学员/运营账号并登录;最后一名运营删不掉。
- 素材库批量传图,生成选「素材库优先」出片画面用上传素材、不够 AI 补。
- 框架画风一键预设梵高/油画,生成图风格明显变化。
- 火山控制台克隆的 `S_xxx` 音色填进 customVoices 后,生成页可选、试听、出片是克隆音色。
- BGM 多选上传、改名、按文件夹分组。
- 全量测试绿。
