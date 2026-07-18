# 书单号复刻版（M1+M2）部署 + 百炼配置清单

> 部署机制（打包/上传/清旧解压/自动迁移）沿用 [`CUTOVER.md`](./CUTOVER.md) 的「日常更新」小节。本文只列**这个版本新增的配置和验收**。服务器 `101.37.151.152`，`docker compose -f docker-compose.prod.yml --env-file .env.prod`。

## 0. 前置
- 合并 PR #33 到 main（含并取代 #32）。
- 本机打包最新 main：`git archive --format=tar.gz -o dongfangwenlan.tar.gz HEAD` → scp 上传。

## 1. `.env.prod` 新增两个变量（关键！）
真 ASR / 声音复刻 / vision 都要百炼来拉**我们服务器上的文件**，靠签名 URL。必须配：

```bash
# .env.prod 追加
ASSET_URL_SECRET=<一段足够长的随机串，如 openssl rand -hex 32>
PUBLIC_BASE_URL=https://<你的域名，与 .env.prod 里 DOMAIN 相同>
```
- `PUBLIC_BASE_URL` 必须是**公网 HTTPS 域名**（Caddy 那个 DOMAIN），不能是 IP/localhost，否则百炼拉不到文件。
- prod compose 用 `env_file: [.env.prod]`，所以加到 `.env.prod` 即可，**无需改 compose**。

## 2. 部署（自动跑新迁移）
按 CUTOVER「日常更新」：先清旧代码再解压，再 `up -d --build`。
```bash
cd ~/dongfangwenlan
find . -maxdepth 1 -mindepth 1 ! -name '.env.prod' ! -name 'data' -exec rm -rf {} +
tar -xzf ~/dongfangwenlan.tar.gz -C ~/dongfangwenlan
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --build
```
`migrate` 会自动应用两条新迁移：`add_cloned_voice`（声音复刻表）、`add_segment_book_fields`（分镜书名/作者/英文字幕）。确认：
```bash
docker compose -f docker-compose.prod.yml --env-file .env.prod logs migrate | tail -20
```

## 3. 百炼能力配置（6 个能力）
后台 `/admin/models`（运营登录）逐个填，或直接 SQL。**所有能力共用你的百炼 base_url + key**（就是现在 llm 用的那个 MAAS 端点）。已在本地真验的可用模型名：

| capability | model | enabled | 说明 |
|---|---|---|---|
| llm | `qwen-plus` | ✅ | 文案 |
| image | `wan2.7-image` | ✅ | 文生图 |
| tts | `qwen-tts` | ✅ | 通用配音；**克隆音色合成会自动切 cosyvoice-v2**（按 voiceId 前缀），无需改这里 |
| asr | `qwen3-asr-flash` | ✅ | 拆解转写（同步，**无句时间戳**）。要节奏对齐的句时间戳需改 `paraformer-v2`（异步，见下） |
| vision | `qwen-vl-max` | ✅ | 识别源画风 |
| 声音复刻 | 用 tts 的配置；target_model 默认 `cosyvoice-v2` | — | 如需换复刻模型，给 tts 的 `extra` 设 `{"targetModel":"cosyvoice-v2"}` |

SQL 兜底（vision 是新能力，若 UI 未列出用这个；复用 llm 凭据）：
```sql
INSERT INTO ai_capability_config (capability, base_url, api_key_enc, model, enabled, updated_at)
SELECT 'vision', base_url, api_key_enc, 'qwen-vl-max', true, now() FROM ai_capability_config WHERE capability='llm'
ON CONFLICT (capability) DO UPDATE SET model='qwen-vl-max', enabled=true;
UPDATE ai_capability_config SET model='qwen3-asr-flash', enabled=true WHERE capability='asr';
```

### 节奏对齐要真句时间戳（可选，需确认）
`qwen3-asr-flash` 只给全文、无句时间戳，此时节奏对齐会「无源节奏 → 不改时间线」（graceful，安全）。要真正按源节奏，需把 asr 改成异步 **`paraformer-v2`**。⚠️ 异步录音识别是**百炼平台服务**，你的 MAAS 专属端点**可能不含它** —— 若配 paraformer 后拆解报错（找不到服务/model），说明该端点不支持，需用标准 DashScope 平台 key，或先用 `qwen3-asr-flash`（节奏走 TTS 时长，不影响出片）。

## 4. 验收（服务器真跑）
1. **拆解**：运营端上传一条书单源视频 → 拆解。确认 `transcripts.full_text` 非空（真转写）、framework 的 `image_style_prompt` 是识别出的画风（如"厚涂油画"）、`overlay_template.books` 有书目。
2. **声音复刻**：拆解结果页「用此声音克隆」→ /admin/voices 出现新音色（真 voiceId）。
3. **生成**：选该框架 + 手填/选题 → 生成 → 确认合成。看成片：书名头 + 厚涂油画配图（无叠字）+ 中英双语字幕 + 水印 + **克隆音色配音**。
4. 抽帧/播放对比源视频，确认「像同一个号」。

## 5. 已知 follow-up（不阻断上线）
- 单张文生图 504 超时会让整任务 FAILED（暂无逐图重试）→ 失败重跑即可，后续加重试。
- cosyvoice 合成 WebSocket 遇 401/403 会等到 60s 超时才报错（key/权限问题时排查慢）。
- `paraformer-v2` 异步 ASR 是否在 MAAS 端点可用，见 §3。

## 6. 排错
- 拆解/声音复刻/vision 报 **URL 拉取失败 / 403**：`PUBLIC_BASE_URL` 没配成公网 HTTPS 域名，或 `ASSET_URL_SECRET` web/worker 不一致（都从 `.env.prod` 读，确认已 `up -d` 重建）。
- 渲染报 **hyperframes / chromium**：worker 镜像装 chromium 走 CN 源可能偶发失败，重建一次；确认 `worker/Dockerfile` 有 `apt install ... chromium` 与 `HYPERFRAMES_BROWSER_PATH`。
- 其余（onnxruntime 302 / next build taskSegment）见 CUTOVER「常见问题」。
