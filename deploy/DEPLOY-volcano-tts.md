# 部署 + 配置火山(豆包语音合成大模型2.0)配音

> 本次代码新增「火山配音」作为可选 TTS provider（真人带情绪），qwen-tts 保留兜底。
> 对接火山「豆包语音合成大模型2.0」单向流式 HTTP：`POST /api/v3/tts/unidirectional`（seed-tts-2.0）。
> 纯代码更新，**无数据库迁移**。服务器：阿里云 `root@101.37.151.152`，域名 `www.dfwl.top`。
> 目标：把偏「人机感」的 qwen-tts 换成火山真人情绪音色。

---

## 一、这次改了什么（无需迁移）

- 火山适配器 `packages/db/src/ai/volcanoTts.ts`：单向流式 HTTP，`X-Api-Key` + `X-Api-Resource-Id: seed-tts-2.0` + `X-Api-Request-Id`；响应是分块 JSON 流，拼接各块 base64 音频成品。
- `ttsSynthesize` 火山分支：**接口地址含 `openspeech.bytedance.com` 时自动走火山**，否则维持 qwen-tts/cosyvoice 原逻辑（完全向后兼容）。
- 音色清单 `TTS_VOICES`：7 个「豆包语音合成2.0」常用音色（知性/温柔/磁性/有声阅读等），生成时可选+试听。
- 后台「模型配置」tts 栏有火山配置提示。

不涉及建表/改表，`migrate` 无新增迁移，正常 `up -d --build` 即可。

---

## 二、发版（沿用日常更新流程）

按 `deploy/CUTOVER.md` 的「日常更新到新版本」小节（**先清旧代码再解压**）：

```bash
# 本机（项目根目录，确认含 seed-tts-2.0 版适配器）
cd /Users/lizhishaoniange/Documents/电商带货混剪工具
git archive --format=tar.gz -o dongfangwenlan.tar.gz HEAD
scp dongfangwenlan.tar.gz root@101.37.151.152:~/

# 服务器：清旧代码（保留 .env.prod 与 data/）再解压
cd ~/dongfangwenlan
# ★ 绝对路径 + 守卫：这条命令依赖当前目录时极其危险 —— 若 cd 没生效（分段粘贴、
# cd 失败、换了终端），它会把当前目录清空。2026-08-31 就因此误删了 /root 下的
# 全部内容（含 .env.prod、data/ 与所有备份）。务必整段一起执行，不要拆开。
APP=/root/dongfangwenlan
test -f "$APP/docker-compose.prod.yml" || { echo "❌ $APP 不像应用目录，已中止"; exit 1; }
find "$APP" -maxdepth 1 -mindepth 1 ! -name '.env.prod' ! -name 'data' -exec rm -rf {} +
tar -xzf ~/dongfangwenlan.tar.gz -C ~/dongfangwenlan

# 构建启动
export COMPOSE_BAKE=false
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --build
```

---

## 三、拿凭据（用户在火山控制台做）

> ⚠️ **seed-tts-2.0 属「语音技术」产品线，与「火山方舟」是两套、需单独开通。** 火山方舟的 `ark-` 开头 key 在此接口**无效**（会报 `Invalid X-Api-Key`，code 45000010）。务必到**语音技术**里拿 key。

1. 进**语音技术**控制台 → 开通「语音合成大模型」（seed-tts-2.0）。
2. 在 **控制台 > API Key 管理**（`https://console.volcengine.com/speech/new/setting/apikeys`）复制 **API Key**（UUID 形式，非 `ark-`）。
3. 音色已内置 7 个；完整音色库见 `https://console.volcengine.com/speech/new/voices`。

---

## 四、后台配置（服务器上线后，浏览器操作）

`https://www.dfwl.top` → 后台**系统 → 模型配置** → **tts 配音**：

| 字段 | 填什么 |
|---|---|
| **接口地址** | `https://openspeech.bytedance.com/api/v3/tts/unidirectional` |
| **模型** | `seed-tts-2.0`（作为 X-Api-Resource-Id） |
| **密钥** | 语音技术控制台的 **API Key**（X-Api-Key） |

填完点「测试连通」→ 通过后点**启用**。

> - 系统靠「接口地址含 openspeech.bytedance.com」自动识别走火山；想切回 qwen-tts，把接口地址改回百炼地址即可。
> - 情感/语气：在 tts 能力配置 `extra` 里加 `emotion`（自然语言语音指令，如「用温柔治愈的语气」）、`voice`（兜底 speaker）。
> - **配置修改不追溯旧任务**，改完要**新生成**才生效。

---

## 五、音色（已内置，可直接用/增删）

已内置 7 个「豆包语音合成2.0」音色（`packages/db/src/ai/ttsVoices.ts` 与 `web/app/admin/generate/page.tsx` 两处一致），生成时在「配音音色」里选、可试听：

| voice_type | 说明 |
|---|---|
| `zh_female_vv_uranus_bigtts` | 知性女声 Vivi（已验证可用） |
| `zh_female_zhixingnv_uranus_bigtts` | 知性女声 |
| `zh_female_wenrouxiaoya_uranus_bigtts` | 温柔女声（治愈） |
| `zh_female_xinlingjitang_uranus_bigtts` | 心灵鸡汤女声 |
| `zh_male_ruyayichen_uranus_bigtts` | 儒雅男声 |
| `zh_male_baqiqingshu_uranus_bigtts` | 磁性青叔（有声阅读） |
| `zh_male_cixingjieshuonan_uranus_bigtts` | 磁性解说男声 |

要增删/换音色：改上面两个文件里的 id+label（**两处保持一致**），重新发版。音色 ID 见控制台音色库或音色列表文档。

---

## 六、验收

1. 后台生成一条书单号 → 播放，配音应是**火山真人情绪音色**（明显比 qwen-tts 自然）。
2. 生成表单里换不同音色 + 试听，声音随之变化。
3. 想临时切回旧音色，改回接口地址即可，无需回滚代码。

## 常见问题

- **`Invalid X-Api-Key`(code 45000010)？** 用了火山方舟的 `ark-` key，或 key 填错。到**语音技术**控制台 API Key 管理拿 key。
- **合成报「火山TTS错误 code=…」？** 火山返回业务错误码（配额/音色不可用/参数），信息里带 code + message，对照火山「错误码查询」处理。
- **音色选了没变化？** 确认两处 `TTS_VOICES`/`TTS_VOICE_OPTIONS` 一致；改完要重新发版 + 新生成。
- **单段文本上限**：seed-tts-2.0 单次文本上限充足，书单号逐句配音无碍。
