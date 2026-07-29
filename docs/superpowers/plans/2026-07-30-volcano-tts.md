# 火山引擎(豆包 Seed-TTS 2.0)配音适配器 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps `- [ ]`.

**Goal:** 接入火山「语音合成大模型 2.0」V3 单向流式 HTTP，作为 TTS 可选 provider（真人情绪，替代偏平的 qwen-tts）；qwen-tts 保留兜底。

**设计（已与用户确认）:**
- 接口：`POST https://openspeech.bytedance.com/api/v3/tts/unidirectional`；头 `X-Api-App-Id`/`X-Api-Access-Key`/`X-Api-Resource-Id`；体 `{user:{uid}, req_params:{text, speaker, audio_params:{format,sample_rate}, additions}}`；响应 NDJSON，`code===0` 行的 `data` 是 base64 音频分片，拼接即成品；`code===20000000` 为流结束。
- **配置映射（复用现有模型配置字段，零 UI 改动）**：tts 的 **接口地址**=V3 URL（据此识别火山）、**模型**=火山 AppID、**密钥**=Access Key；`resourceId` 默认 `seed-tts-2.0`（可用 extra.resourceId 覆盖）；情感可用 extra.emotion（自然语言）。
- voice → speaker（火山音色ID）。qwen-tts 分支不变（baseUrl 非火山时走原逻辑）。

**Global Constraints:** 向后兼容（非火山 baseUrl → 原 qwen-tts/cosyvoice/mock 路径不变）；纯函数可单测；无迁移；现有测试回归绿。真音频验证需用户火山凭据（服务器上做）。

---

## Task 1：火山适配器 volcanoTts.ts（纯函数 + 合成）
**Files:** Create `packages/db/src/ai/volcanoTts.ts` + test；Modify `packages/db/src/ai/index.ts`(导出)

**Produces:**
- `isVolcano(baseUrl: string): boolean`（含 `openspeech.bytedance.com`）
- `buildVolcanoBody(text: string, speaker: string, emotionText?: string): object`
- `parseVolcanoAudio(ndjson: string): Buffer`（收集 code===0 的 data base64 拼接；无音频抛错）
- `volcanoTtsSynthesize(o:{endpoint,appId,accessKey,resourceId,text,speaker,emotionText?}): Promise<Buffer>`

- [ ] Step 1 失败测试
```ts
// packages/db/src/ai/volcanoTts.test.ts
import { describe, it, expect } from 'vitest'
import { isVolcano, buildVolcanoBody, parseVolcanoAudio } from './volcanoTts'
describe('isVolcano', () => {
  it('按 openspeech 域名识别', () => {
    expect(isVolcano('https://openspeech.bytedance.com/api/v3/tts/unidirectional')).toBe(true)
    expect(isVolcano('https://dashscope.aliyuncs.com/x')).toBe(false)
  })
})
describe('buildVolcanoBody', () => {
  it('含 text/speaker/audio_params;无情感时不带 additions', () => {
    const b = buildVolcanoBody('你好', 'zh_female_x') as any
    expect(b.req_params.text).toBe('你好')
    expect(b.req_params.speaker).toBe('zh_female_x')
    expect(b.req_params.audio_params.format).toBe('mp3')
    expect(b.req_params.additions).toBeUndefined()
  })
  it('有情感时 additions 为序列化 JSON 含 context_texts', () => {
    const b = buildVolcanoBody('你好', 'v', '用温柔治愈的语气') as any
    expect(typeof b.req_params.additions).toBe('string')
    expect(JSON.parse(b.req_params.additions).context_texts).toEqual(['用温柔治愈的语气'])
  })
})
describe('parseVolcanoAudio', () => {
  it('拼接 code===0 行的 base64,忽略结束行', () => {
    const a = Buffer.from('AA').toString('base64'), b = Buffer.from('BB').toString('base64')
    const nd = [JSON.stringify({code:0,data:a}), JSON.stringify({code:0,data:b}), JSON.stringify({code:20000000})].join('\n')
    expect(parseVolcanoAudio(nd).toString()).toBe('AABB')
  })
  it('无音频行 → 抛错', () => {
    expect(() => parseVolcanoAudio(JSON.stringify({code:20000000}))).toThrow()
  })
})
```
- [ ] Step 2 运行失败：`npx vitest run packages/db/src/ai/volcanoTts.test.ts`
- [ ] Step 3 实现
```ts
// packages/db/src/ai/volcanoTts.ts
// 火山「语音合成大模型2.0」V3单向流式HTTP适配器。响应 NDJSON, code===0 行 data 为 base64 音频分片。
export function isVolcano(baseUrl: string): boolean {
  return typeof baseUrl === 'string' && baseUrl.includes('openspeech.bytedance.com')
}
export function buildVolcanoBody(text: string, speaker: string, emotionText?: string): object {
  const req_params: Record<string, unknown> = {
    text, speaker, audio_params: { format: 'mp3', sample_rate: 24000 },
  }
  if (emotionText && emotionText.trim()) {
    req_params.additions = JSON.stringify({ context_texts: [emotionText.trim()] })
  }
  return { user: { uid: 'dongfangwenlan' }, req_params }
}
export function parseVolcanoAudio(ndjson: string): Buffer {
  const chunks: Buffer[] = []
  for (const line of String(ndjson ?? '').split('\n')) {
    const t = line.trim(); if (!t) continue
    let obj: { code?: number; data?: string; message?: string }
    try { obj = JSON.parse(t) } catch { continue }
    if (obj.code === 0 && typeof obj.data === 'string' && obj.data) chunks.push(Buffer.from(obj.data, 'base64'))
  }
  if (chunks.length === 0) throw new Error(`火山TTS无音频返回: ${String(ndjson).slice(-300)}`)
  return Buffer.concat(chunks)
}
export async function volcanoTtsSynthesize(o: {
  endpoint: string; appId: string; accessKey: string; resourceId: string
  text: string; speaker: string; emotionText?: string
}): Promise<Buffer> {
  const res = await fetch(o.endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Api-App-Id': o.appId,
      'X-Api-Access-Key': o.accessKey,
      'X-Api-Resource-Id': o.resourceId,
    },
    body: JSON.stringify(buildVolcanoBody(o.text, o.speaker, o.emotionText)),
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`火山TTS请求失败 ${res.status}: ${text.slice(0, 300)}`)
  return parseVolcanoAudio(text)
}
```
- `index.ts` 导出 `isVolcano, buildVolcanoBody, parseVolcanoAudio, volcanoTtsSynthesize`。
- [ ] Step 4 通过 + `tsc`(db 由 worker tsconfig 覆盖)
- [ ] Step 5 提交 `feat(tts): 火山豆包 Seed-TTS 2.0 V3 适配器 volcanoTts.ts`

---

## Task 2：ttsSynthesize 路由火山 + 音色清单换火山
**Files:** Modify `packages/db/src/ai/tts.ts`（火山分支）、`packages/db/src/ai/ttsVoices.ts`（换火山候选音色）、`web/app/admin/generate/page.tsx`（TTS_VOICE_OPTIONS 镜像同步）；Test `ttsVoices.test.ts`（更新）

**Interfaces:** `ttsSynthesize` 在 mock 判断后、cosyvoice/dashscope 前加：
```ts
if (isVolcano(cfg.baseUrl)) {
  const speaker = opts.voice ?? (cfg.extra.voice as string) ?? TTS_VOICES[0].id
  return volcanoTtsSynthesize({
    endpoint: cfg.baseUrl, appId: cfg.model, accessKey: cfg.apiKey,
    resourceId: (cfg.extra.resourceId as string) || 'seed-tts-2.0',
    text: opts.text, speaker, emotionText: (cfg.extra.emotion as string) || undefined,
  })
}
```
（import isVolcano/volcanoTtsSynthesize from `./volcanoTts`；TTS_VOICES from `./ttsVoices`。）

- [ ] Step 1 `ttsVoices.ts` 换成火山候选音色（占位，部署后按控制台可用音色替换）：
```ts
export const TTS_VOICES: TtsVoice[] = [
  // 火山 Seed-TTS 2.0 音色ID（占位!部署后按控制台开通的实际 speaker 替换/增删）
  { id: 'zh_female_wanwanxiaohe_moon_bigtts', label: '知性女声（待确认）' },
  { id: 'zh_male_M392_conversation_wvae_bigtts', label: '磁性男声（待确认）' },
]
```
（保留 `isValidVoice`/`TtsVoice` 不变。）
- [ ] Step 2 `tts.ts` 加火山分支（上面 Interfaces）；`web/app/admin/generate/page.tsx` 的 `TTS_VOICE_OPTIONS` 同步成同样两项。
- [ ] Step 3 更新 `ttsVoices.test.ts`（断言清单非空 + isValidVoice 用新 id；去掉旧 Cherry 断言）。
- [ ] Step 4 通过 + `tsc -p worker` + `npm run build -w web`（忽略 postgres 静态告警）
- [ ] Step 5 提交 `feat(tts): ttsSynthesize 路由火山 + 音色清单换火山情绪音色`

---

## Task 3：模型配置提示 + 交付文档
**Files:** Modify `web/app/admin/models/page.tsx`（tts 行加火山配置提示）、`docs/交付说明-快闪书单号.md`（配置火山说明）

- [ ] Step 1 models 页：给 tts 那栏加一句说明/placeholder：「火山配音：接口地址填 `https://openspeech.bytedance.com/api/v3/tts/unidirectional`，模型填火山 AppID，密钥填 Access Key」。（纯文案提示，不改保存逻辑。）
- [ ] Step 2 交付文档「AI 能力」表补一行：tts 可选 火山（配置映射同上）+ 音色 speaker 需按控制台开通替换。
- [ ] Step 3 `npm run build -w web` 通过
- [ ] Step 4 提交 `docs(tts): 火山配音配置说明(模型配置页提示+交付文档)`

---

## Task 4：本地验收（无凭据部分）+ 汇总
- [ ] `volcanoTts` 纯函数测试绿（body/parse/isVolcano）。
- [ ] 全量测试绿（测试库）；`tsc`；`npm run build -w web`。
- [ ] 说明：真音频/情绪效果需用户在服务器配火山 AppID/AccessKey/speaker 后试听验收；音色ID为占位待替换。
- [ ] ledger 记录；文档追加实测待办。

---

## Self-Review
- 覆盖：适配器(T1)+路由/音色(T2)+配置提示/文档(T3)+验收(T4)。
- 向后兼容：仅 baseUrl 含 openspeech 才走火山；qwen-tts/cosyvoice/mock 分支不动。
- 类型一致：isVolcano/buildVolcanoBody/parseVolcanoAudio/volcanoTtsSynthesize（T1）↔ tts.ts 调用（T2）；TTS_VOICES 换 id，isValidVoice/readVoice 仍据白名单。
- 占位音色ID明确标注待替换；真验依赖用户凭据。
