# 部署 + 配置火山(豆包 音频生成 seed-audio-1.0)配音

> 本次代码新增「火山配音」作为可选 TTS provider（真人带情绪），qwen-tts 保留兜底。
> 对接火山「音频生成HTTP」接口 `POST /api/v3/tts/create`（同步返回，seed-audio-1.0 模型）。
> 纯代码更新，**无数据库迁移**。服务器：阿里云 `root@101.37.151.152`，域名 `www.dfwl.top`。
> 目标：把偏「人机感」的 qwen-tts 换成火山真人情绪音色。

---

## 一、这次改了什么（无需迁移）

- 新增火山「音频生成HTTP」适配器 `packages/db/src/ai/volcanoTts.ts`（同步接口 `/api/v3/tts/create`，X-Api-Key 单头鉴权，返回 audio(base64) 或 url(2h) 自动取音频字节）。
- `ttsSynthesize` 新增火山分支：**接口地址含 `openspeech.bytedance.com` 时自动走火山**，否则维持 qwen-tts/cosyvoice 原逻辑（完全向后兼容）。
- 音色清单 `TTS_VOICES` 为 2 个火山**占位**音色（需按控制台可用音色替换）。
- 后台「模型配置」tts 栏加了火山配置提示文案。

不涉及建表/改表，`migrate` 无新增迁移，正常 `up -d --build` 即可。

---

## 二、发版（沿用日常更新流程）

按 `deploy/CUTOVER.md` 的「日常更新到新版本」小节执行（**先清旧代码再解压**）：

```bash
# 本机（项目根目录，确认在最新代码，含火山 create 版适配器）
cd /Users/lizhishaoniange/Documents/电商带货混剪工具
git archive --format=tar.gz -o dongfangwenlan.tar.gz HEAD
scp dongfangwenlan.tar.gz root@101.37.151.152:~/

# 服务器：清旧代码（保留 .env.prod 与 data/）再解压
cd ~/dongfangwenlan
find . -maxdepth 1 -mindepth 1 ! -name '.env.prod' ! -name 'data' -exec rm -rf {} +
tar -xzf ~/dongfangwenlan.tar.gz -C ~/dongfangwenlan

# 构建启动
export COMPOSE_BAKE=false
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --build
```

> 本次无迁移，风险低；重要更新前仍建议先 `pg_dump` 备份（见 CUTOVER 第 0 步）。

---

## 三、拿凭据（用户在火山控制台做）

> ⚠️ **TTS 属「语音技术」产品线，与「火山方舟」是两套、需单独开通。** 火山方舟的 `ark-` 开头 key 在此接口**无效**（会报 `Invalid X-Api-Key`）。务必到「语音技术」里拿凭据。

1. 火山控制台进 **「语音技术」**（不是方舟）→ 开通 **「语音合成大模型 / 音频生成」**。
2. 在**语音技术**控制台拿凭据，两种之一（适配器都支持）：
   - **新版**：一个 **X-Api-Key**（单头）。
   - **旧版**：**APP ID + Access Token**（双头）。
3. 记下要用的 **speaker 音色 ID**：可用「豆包语音合成模型2.0」的音色（形如 `zh_female_xxx_bigtts`）或你的声音复刻音色。

---

## 四、后台配置（服务器上线后，浏览器操作）

进入 `https://www.dfwl.top` → 后台**系统 → 模型配置**（`/admin/models`）的 **tts 配音** 一栏：

| 字段 | 填什么 |
|---|---|
| **接口地址** | `https://openspeech.bytedance.com/api/v3/tts/create` |
| **模型** | `seed-audio-1.0`（中英）或 `seed-audio-1.0-multilingual`（多语种+时间轴） |
| **密钥** | 新版：**X-Api-Key**；旧版：**Access Token**（此时还要在 `extra.appId` 填 **APP ID**） |

填完点「测试连通」→ 通过后点**启用**。

> - 系统靠「接口地址含 openspeech.bytedance.com」自动识别走火山；想切回 qwen-tts，把接口地址改回百炼地址即可。
> - **旧版双头凭据**：密钥填 Access Token，并在能力配置 `extra` 里加 `appId`=你的 APP ID（适配器检测到 appId 就自动走 `X-Api-App-Id` + `X-Api-Access-Key` 双头）。
> - 可在 `extra` 里加 `emotion`（自然语言语气，如「用温柔治愈的语气」，会前置到合成 Prompt）、`voice`（兜底 speaker）。
> - **配置修改不追溯旧任务**，改完要**新生成**才生效。

---

## 五、替换占位音色为真实 speaker（改代码 → 重新发版）

当前音色是占位 ID，换成你控制台可用的音色，两处要**保持一致**：

1. `packages/db/src/ai/ttsVoices.ts` 的 `TTS_VOICES`：
   ```ts
   export const TTS_VOICES: TtsVoice[] = [
     { id: '<你的女声speaker>', label: '知性女声' },
     { id: '<你的男声speaker>', label: '磁性男声' },
     // 可增删
   ]
   ```
2. `web/app/admin/generate/page.tsx` 的 `TTS_VOICE_OPTIONS`：改成**完全相同**的 id + label。

改完重新发版（第二步流程）。生成任务时在「配音音色」里选，点「试听」即可听到该音色效果。

---

## 六、验收

1. 后台生成一条书单号 → 完成后播放，配音应是**火山真人情绪音色**（明显比 qwen-tts 自然）。
2. 生成表单里换不同音色 + 试听，声音随之变化。
3. 若想临时切回旧音色，改回接口地址即可，无需回滚代码。

## 常见问题

- **`Invalid X-Api-Key`(code 45000010)？** API Key 填错，或用了旧版双头凭据。到 控制台 > API Key 管理 拿新版 Key 填「密钥」。
- **`unmapped key user`(code 45000000)？** 说明接口地址填成了别的接口。必须是 `/api/v3/tts/create`。
- **合成报「火山TTS错误 code=…」？** 火山返回业务错误码（配额/内容合规/音色不可用/参数）——错误信息里带 code 和 message，对照火山「错误码查询」文档处理。
- **音色选了没变化？** 确认 `TTS_VOICES` 与 `TTS_VOICE_OPTIONS` 两处 id 一致且是控制台可用音色；改完要重新发版 + 新生成。
- **单段文本上限**：text_prompt 最大 3000 字符、单次音频最长 120s；书单号逐句配音远小于此，无碍。
