# 部署 + 配置火山(豆包 Seed-TTS 2.0)配音

> 本次代码新增「火山配音」作为可选 TTS provider（真人带情绪），qwen-tts 保留兜底。
> 纯代码更新，**无数据库迁移**。服务器：阿里云 `root@101.37.151.152`，域名 `www.dfwl.top`。
> 上线目标：把偏「人机感」的 qwen-tts 换成火山真人情绪音色。

---

## 一、这次改了什么（无需迁移）

- 新增火山 V3 单向流式 HTTP 适配器 `packages/db/src/ai/volcanoTts.ts`。
- `ttsSynthesize` 新增火山分支：**接口地址含 `openspeech.bytedance.com` 时自动走火山**，否则维持 qwen-tts/cosyvoice 原逻辑（完全向后兼容）。
- 音色清单 `TTS_VOICES` 换成 2 个火山**占位**音色（需按控制台开通替换）。
- 后台「模型配置」tts 栏加了火山配置提示文案。

不涉及建表/改表，`migrate` 无新增迁移，正常 `up -d --build` 即可。

---

## 二、发版（沿用日常更新流程）

按 `deploy/CUTOVER.md` 的「日常更新到新版本」小节执行（**先清旧代码再解压**，否则残留旧文件会致 `next build` 失败）：

```bash
# 本机（项目根目录，确认在最新 main / feat 分支，含火山提交 e9a162a）
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

> 重要更新前仍建议先 `pg_dump` 备份（见 CUTOVER 第 0 步）。本次无迁移，风险低。

---

## 三、开通火山 + 拿凭据（用户在火山控制台做）

1. 登录**火山引擎控制台** → 开通「语音技术 / 语音合成大模型」（Seed-TTS 2.0）。
2. 在应用管理里拿到三样东西：
   - **App ID**（应用 ID）
   - **Access Token / Access Key**（访问密钥）
   - 确认资源 ID（Resource Id），默认 `seed-tts-2.0`（一般无需改）。
3. 在**音色列表**里记下你已开通/可用的 **speaker 音色 ID**（形如 `zh_female_xxx_bigtts`）——下面第五步要用真实值替换占位。

---

## 四、后台配置（服务器上线后，浏览器操作）

进入 `https://www.dfwl.top` → 后台**系统 → 模型配置**（`/admin/models`）的 **tts 配音** 一栏：

| 字段 | 填什么 |
|---|---|
| **接口地址** | `https://openspeech.bytedance.com/api/v3/tts/unidirectional` |
| **模型** | 火山 **App ID** |
| **密钥** | 火山 **Access Key / Access Token** |

填完点「测试连通」→ 通过后点**启用**。

> - 系统靠「接口地址含 openspeech.bytedance.com」自动识别走火山；想切回 qwen-tts，把接口地址改回百炼地址即可。
> - 想指定情感/资源 ID，可在该能力配置的 `extra` 里加 `resourceId`（默认 seed-tts-2.0）、`emotion`（自然语言，如「用温柔治愈的语气」）、`voice`（兜底 speaker）。
> - **配置修改不追溯旧任务**，改完要**新生成**才生效。

---

## 五、替换占位音色为真实 speaker（改代码 → 重新发版）

当前音色是占位 ID，必须换成你控制台实际开通的音色，两处要**保持一致**：

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

- **报鉴权/401、403？** App ID / Access Key 填错，或该音色未在控制台开通。核对第三步。
- **合成报「火山TTS流错误 code=…」？** 火山返回了错误码（配额/内容合规/参数）——错误信息里带 code 和 message，按火山文档对照处理。
- **音色选了没变化？** 确认 `TTS_VOICES` 与 `TTS_VOICE_OPTIONS` 两处 id 一致且是控制台真实音色；改完要重新发版 + 新生成。
- **想要更强情绪？** 在 tts 能力 `extra.emotion` 填自然语言情绪描述（火山按上下文调整语气）。
