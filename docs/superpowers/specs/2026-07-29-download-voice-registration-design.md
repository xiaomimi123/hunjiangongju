# 下载可靠性 + 配音音色选择/试听 + 注册开关 设计

> 状态：设计定稿待评审 · 2026-07-29 · 分支 feat/shudan-m1
> 三件相对独立的迭代，一批做完。**带宽是移动端根因，属运维（用户调阿里云），本文不含。**

---

## 模块 A：下载可靠性（问题1/4 的代码侧）

### 现状/问题
`/api/files/[...path]` 返回视频时**不设 `Content-Disposition`** → 移动端下载显示"<未知>"、行为不稳；同一路由既给 `<video>` 内联播放又给下载。成片体积偏大（17MB 级）在慢网下更易失败。

### 设计
1. **下载头**：给 `/api/files` 加可选 query `?download=1`：带此参数时响应加
   `Content-Disposition: attachment; filename="<安全文件名>"`（文件名取 URL 末段，非 ASCII 用 `filename*=UTF-8''` 编码）；不带参数时保持内联（播放器不受影响）。
2. **成片库下载链接**：`(student)/library/page.tsx` 的「下载 MP4/字幕 SRT」`href` 加 `?download=1`；`<video src>` 播放器**不加**（继续内联）。
3. **压小体积**：`render-video` 的 ffmpeg 编码加 `-crf 28`（当前默认约 23）→ 体积约减半，画质对本类内容可接受，慢网更易下完。

### 非目标
- Caddy 静态吐视频（需鉴权取舍，另议）；带宽（运维）。

### 测试
- `/api/files` 单测/或纯函数化文件名编码 + 断言带 `?download=1` 时含 `Content-Disposition: attachment`、不带时不含。
- `buildFfmpegArgs` 断言含 `-crf 28`。
- 现有 range/inline 行为回归不变。

---

## 模块 B：配音音色选择 + 试听（问题2）

### 现状
`generateTts` 只读克隆 `voiceId`；无普通音色选择，配音走默认 Cherry。

### 设计
1. **音色清单**（可编辑常量）：`packages/db` 或 worker 内一个 `TTS_VOICES: {id,label}[]`，初版放若干 qwen-tts 候选音色（如 Cherry/Serena/Ethan/Chelsie），中文标签占位（"知性女声/男声…"）。**具体音色名与音质由部署后试听确认再锁定**（本机连百炼不稳，不在此定死）。
2. **试听接口** `POST /api/tts/preview`（仅运营、限流）：入参 `voice`（须在 TTS_VOICES 白名单内，防注入）→ 用固定示例句（如"今天分享的是活着，一段治愈系文案"）调 `ttsSynthesize({text, voice})` → 返回 `audio/mpeg`。
3. **生成表单**：加「配音音色」选择器，每个音色一个「试听」按钮（点→请求 preview→播放 audio）；选中项写入 `variables.voice`。
4. **透传**：`generateTts` 读 `variables.voice`（纯函数 `readVoice`），传 `ttsSynthesize({text, voice, ...voiceId})`；`buildDashTtsBody` 已有 `voice ?? 'Cherry'` 回退，无需改。
5. 与「去掉声音复刻」一致：本模块用预置音色替代克隆入口（声音复刻 UI 的收起在"后台精简"另做，本批不动其代码）。

### 测试
- `readVoice(variables)` 纯测（取白名单内 voice；非法/缺省→undefined）。
- preview 接口：白名单校验（非法 voice → 400）；operator 鉴权。
- generateTts 传参含 voice（mock）。

---

## 模块 C：注册开关（问题3）

### 现状
登录页有「注册」标签可自助注册；`/api/auth/register`、`/api/auth/send-code` 无开关，谁都能注册成 student。

### 设计（默认**关闭**，邀请制）
1. **设置项**：`smtp_config`（系统配置单例行 id=1）加列 `registration_open Boolean @default(false)`。**需一条加列迁移**（加列，安全）。
   > 复用现有系统配置单例，`/admin/settings` 已 CRUD 该行，最省改动。
2. **公开状态**：`/api/auth/config` 返回体加 `registrationOpen`（供登录页判断）。
3. **门控**：`/api/auth/register` 与 `/api/auth/send-code`（kind=register 的发码）在处理前检查 `registrationOpen`，关闭时抛 `HttpError(403, '注册未开放')`。（`forgot`/`reset` 找回密码不受影响。）
4. **登录页**：`registrationOpen=false` 时**隐藏「注册」标签**，只留「登录」（找回密码保留）。
5. **后台开关**：`/admin/settings` 加「开放注册」开关，写回 `smtp_config.registration_open`。

### 测试
- register/send-code：`registrationOpen=false` → 403；`true` → 走原流程（现有测试在 true 下回归）。
- `/api/auth/config` 返回含 `registrationOpen`。
- 登录页：关闭时不渲染注册标签（组件层）。

---

## 全局约束
- 向后兼容：`?download=1` 不带时行为不变；`variables.voice` 缺省走默认音色；`registrationOpen` 默认 false（**上线即变邀请制**——交付预期如此）。
- 一条加列迁移（`registration_open`），加列安全、`migrate deploy` 幂等。
- 纯函数可单测；现有全部测试回归绿。

## 验收
- 移动端（**带宽调高后**）：成片库能播、「下载 MP4」文件名正常且能下完。
- 生成任务时能试听多个音色、选一个作为配音；成片配音=所选音色。
- 前端只有登录、无注册入口；后台「开放注册」打开后注册可用、关闭后注册报"未开放"。
- 全量测试绿。

## 部署注意
- 含一条迁移（`registration_open`）→ 部署时 `migrate` 自动应用。
- 音色标签部署后试听锁定（不阻断上线，先用占位标签）。
