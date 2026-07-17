# 书单号风格复刻与批量生成 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让「拆解→生成」真正基于源视频产出：真 ASR 转写、真文案提炼、克隆音色（M1），画风/版式/节奏对齐书单号（M2）。

**Architecture:** monorepo（packages/db 共享逻辑+Prisma、web Next.js、worker BullMQ）。AI 能力在 `packages/db/src/ai/*`，每能力 mock + 真实分支。拆解/生成流水线在 `worker/src/gen/*`，按 BullMQ job 串联。本计划新增 ASR 异步适配、资产签名 URL、声音复刻适配、生成矩阵；M2 加 vision 与模板版式。

**Tech Stack:** TypeScript、Next.js 14、Prisma、BullMQ、阿里云百炼 DashScope（LLM/qwen-asr/paraformer/CosyVoice/qwen-vl）、ffmpeg、HyperFrames、vitest。

## Global Constraints

- **百炼 DashScope 兼容性**：仅 LLM 走 OpenAI 兼容；文生图/TTS/ASR/vision 走原生 `multimodal-generation` 或异步录音识别接口；模型名**小写连字符**，填错=404；用户 endpoint 在**北京**地域。
- **每个 DashScope 适配器实现前**：先 WebFetch 对应官方文档核对确切 `model` id / 请求体字段 / 响应结构，再写代码；用最小 curl/脚本在**服务器**打通一次，再接流水线。
- **资产 URL 须 DashScope 可达**：ASR 与声音复刻的音频必须是公网可达 URL；本地 localhost 不可达 → 本地走 mock，真实验证在服务器。
- **工作流**：本地 Docker 用 mock 打通逻辑与流水线 → 推服务器真跑；禁止未在本地打通就推。
- **整篇配音分段合成**：TTS 按分镜逐段合成再拼接，规避文本长度上限。
- **测试**：纯逻辑/解析用 vitest + mock fetch（DB 测试须在容器内 `docker compose exec web npm test`，本机连不到 postgres:5432）。
- **构建 gotcha**：docker build 禁 BuildKit（中文路径）；本地构建传 `--build-arg CN=0`。
- 文档随代码更新（README / docs）。

---

# 里程碑 M1：文案像 + 声音像

## Task 1: 拆解字数上限修复（F3）

修复「段数与字数上限不一致」导致的生成必失败（11 段/120 字死结）。

**Files:**
- Modify: `worker/src/gen/extractFramework.ts:85`
- Create: `packages/db/src/scriptPolicy.ts` 内新增导出函数 `deriveCharBudget`（与 `validateScript` 同文件）
- Test: `packages/db/src/scriptPolicy.test.ts`

**Interfaces:**
- Produces: `deriveCharBudget(segmentCount: number, transcriptLen: number): { maxLines: number; maxTotalChars: number }`
  - 规则：每段期望 ~18 字；`maxTotalChars = clamp(round(segmentCount*18), 下限=segmentCount*8, 上限=600)`；同时不低于 `transcriptLen` 的合理下限（`min(transcriptLen, 600)`）取较大者以贴合源；`maxLines = max(段数, 现有默认21? -> 用 max(segmentCount, ceil(maxTotalChars/12)))`。

- [ ] **Step 1: 写失败测试**

```ts
// packages/db/src/scriptPolicy.test.ts
import { describe, it, expect } from 'vitest'
import { deriveCharBudget } from './scriptPolicy'

describe('deriveCharBudget', () => {
  it('段数多时字数上限随之提高，保证每段够写', () => {
    const { maxTotalChars, maxLines } = deriveCharBudget(11, 0)
    expect(maxTotalChars).toBeGreaterThanOrEqual(11 * 8) // 每段至少 8 字余量
    expect(maxLines).toBeGreaterThanOrEqual(11)
  })
  it('封顶 600', () => {
    expect(deriveCharBudget(60, 5000).maxTotalChars).toBeLessThanOrEqual(600)
  })
  it('少段数不至过小', () => {
    expect(deriveCharBudget(3, 0).maxTotalChars).toBeGreaterThanOrEqual(3 * 8)
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `docker compose exec -T web sh -lc "cd /app && npx vitest run packages/db/src/scriptPolicy.test.ts"`
Expected: FAIL（`deriveCharBudget is not a function`）

- [ ] **Step 3: 实现 deriveCharBudget**

```ts
// packages/db/src/scriptPolicy.ts 追加
export function deriveCharBudget(segmentCount: number, transcriptLen: number) {
  const seg = Math.max(1, segmentCount)
  const perSeg = 18
  const floor = seg * 8
  const bySeg = Math.round(seg * perSeg)
  const byText = Math.min(transcriptLen || 0, 600)
  const maxTotalChars = Math.min(600, Math.max(floor, bySeg, byText))
  const maxLines = Math.max(seg, Math.ceil(maxTotalChars / 12))
  return { maxLines, maxTotalChars }
}
```

- [ ] **Step 4: extractFramework 改用它**

`worker/src/gen/extractFramework.ts` 中替换第 85 行附近：
```ts
import { deriveCharBudget } from '@mixcut/db'
// ...
const { maxLines, maxTotalChars } = deriveCharBudget(suggestedSegmentCount, textLen)
```
（删除原 `const maxTotalChars = ...` 与独立 `maxLines` 赋值，改用上面解构值写入 framework。）

- [ ] **Step 5: 跑测试通过 + tsc**

Run: `docker compose exec -T web sh -lc "cd /app && npx vitest run packages/db/src/scriptPolicy.test.ts" && npx tsc -p worker/tsconfig.json --noEmit`
Expected: PASS，tsc 0

- [ ] **Step 6: 提交**

```bash
git add packages/db/src/scriptPolicy.ts packages/db/src/scriptPolicy.test.ts worker/src/gen/extractFramework.ts
git commit -m "fix(gen): 拆解字数上限随段数联动，消除段多字少的死结"
```

---

## Task 2: 资产签名 URL（F1）

让 DashScope 能通过公网 URL 拉到本地/服务器上的音频与帧。

**Files:**
- Create: `packages/db/src/assets/signedUrl.ts`
- Modify: `web/app/api/files/[...path]/route.ts`（校验 token；若结构不同则按实际路由文件）
- Test: `packages/db/src/assets/signedUrl.test.ts`

**Interfaces:**
- Produces:
  - `signAssetPath(relPath: string, ttlSec: number, now: number): string`（返回 `token`）
  - `verifyAssetToken(relPath: string, token: string, now: number): boolean`
  - `publicAssetUrl(relPath: string, ttlSec?: number): string`（读 `PUBLIC_BASE_URL` env 拼绝对 URL：`${base}/api/files/${relPath}?t=${expiry}&sig=${token}`）
- Consumes: env `ASSET_URL_SECRET`、`PUBLIC_BASE_URL`

- [ ] **Step 1: 写失败测试**

```ts
// packages/db/src/assets/signedUrl.test.ts
import { describe, it, expect, beforeAll } from 'vitest'
import { signAssetPath, verifyAssetToken } from './signedUrl'

beforeAll(() => { process.env.ASSET_URL_SECRET = 'test-secret' })

describe('signed asset url', () => {
  it('签发的 token 在有效期内可验证', () => {
    const now = 1_000_000
    const tok = signAssetPath('gen/a/final.mp4', 600, now)
    expect(verifyAssetToken('gen/a/final.mp4', tok, now + 10_000)).toBe(true)
  })
  it('过期失败', () => {
    const now = 1_000_000
    const tok = signAssetPath('gen/a/final.mp4', 1, now)
    expect(verifyAssetToken('gen/a/final.mp4', tok, now + 5_000)).toBe(false)
  })
  it('路径不符失败（防越权）', () => {
    const now = 1_000_000
    const tok = signAssetPath('gen/a/final.mp4', 600, now)
    expect(verifyAssetToken('gen/b/other.mp4', tok, now + 1000)).toBe(false)
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `docker compose exec -T web sh -lc "cd /app && npx vitest run packages/db/src/assets/signedUrl.test.ts"`
Expected: FAIL

- [ ] **Step 3: 实现 signedUrl.ts**

```ts
// packages/db/src/assets/signedUrl.ts
import { createHmac } from 'crypto'

function secret() {
  const s = process.env.ASSET_URL_SECRET
  if (!s) throw new Error('ASSET_URL_SECRET 未配置')
  return s
}
// token = `${expiryMs}.${hmac(relPath|expiryMs)}`
export function signAssetPath(relPath: string, ttlSec: number, now: number): string {
  const expiry = now + ttlSec * 1000
  const mac = createHmac('sha256', secret()).update(`${relPath}|${expiry}`).digest('hex').slice(0, 32)
  return `${expiry}.${mac}`
}
export function verifyAssetToken(relPath: string, token: string, now: number): boolean {
  const [expStr, mac] = token.split('.')
  const expiry = Number(expStr)
  if (!Number.isFinite(expiry) || now > expiry) return false
  const expect = createHmac('sha256', secret()).update(`${relPath}|${expiry}`).digest('hex').slice(0, 32)
  return mac === expect
}
export function publicAssetUrl(relPath: string, ttlSec = 3600): string {
  const base = process.env.PUBLIC_BASE_URL
  if (!base) throw new Error('PUBLIC_BASE_URL 未配置')
  const tok = signAssetPath(relPath, ttlSec, Date.now())
  return `${base.replace(/\/$/, '')}/api/files/${relPath}?sig=${encodeURIComponent(tok)}`
}
```

- [ ] **Step 4: /api/files 校验 token（仅当带 sig 时强校验）**

先 `Read` 现有 `web/app/api/files/` 路由，找到读文件返回处，在返回前加：
```ts
// 若带 sig（供外部服务/DashScope 拉取），必须校验；无 sig 走原有内部鉴权
const sig = req.nextUrl.searchParams.get('sig')
if (sig && !verifyAssetToken(relPath, sig, Date.now())) {
  return new Response('invalid or expired signature', { status: 403 })
}
```
（`relPath` 为该路由已解析的相对路径变量名，按实际代码接入。）

- [ ] **Step 5: env 样例 + 跑测试**

在 `.env.example`、`docker-compose*.yml` 的 web/worker 环境加 `ASSET_URL_SECRET`、`PUBLIC_BASE_URL`（本地可设 `http://localhost:3000`，注明本地不可供 DashScope 拉取）。
Run: `docker compose exec -T web sh -lc "cd /app && npx vitest run packages/db/src/assets/signedUrl.test.ts"`
Expected: PASS

- [ ] **Step 6: 提交**

```bash
git add packages/db/src/assets/signedUrl.ts packages/db/src/assets/signedUrl.test.ts web/app/api/files .env.example docker-compose.yml docker-compose.dev.yml
git commit -m "feat(assets): 资产签名 URL，供 DashScope 拉取音频/帧"
```

---

## Task 3: 真 ASR 适配器（F2）

DashScope 录音文件识别（优先 qwen-asr 同步，长音频回退 Paraformer 异步），产出带时间戳句子。

**Files:**
- Create: `packages/db/src/ai/dashscopeAsync.ts`（异步提交/轮询）
- Modify: `packages/db/src/ai/asr.ts`（DashScope 分支）
- Modify: `worker/src/gen/transcribe.ts`（真实调用，写 Transcript.sentences）
- Test: `packages/db/src/ai/asr.test.ts`（mock fetch 解析）

**Interfaces:**
- Produces: `asrTranscribe(opts:{ audioUrl:string }): Promise<{ fullText:string; sentences:{text:string;startMs:number;endMs:number}[] }>`（扩展现有签名，保留 mock 分支）
- `dashAsyncSubmit(baseUrl,apiKey,path,body): Promise<string /*taskId*/>`、`dashAsyncPoll(baseUrl,apiKey,taskId,{intervalMs,timeoutMs}): Promise<any>`

- [ ] **Step 0（前置，必做）**：WebFetch 官方文档核对确切接口
  - `https://help.aliyun.com/zh/model-studio/qwen-asr-api-reference`（qwen-asr 同步/多模态字段、model id）
  - `https://help.aliyun.com/zh/model-studio/paraformer-recorded-speech-recognition-restful-api`（异步 header `X-DashScope-Async: enable`、提交/查询 URL、结果 transcription_url 结构、时间戳字段）
  - 记录确切字段到本任务备注，作为下方代码的事实来源。

- [ ] **Step 1: 写失败测试（解析层，mock fetch）**

```ts
// packages/db/src/ai/asr.test.ts
import { describe, it, expect, vi } from 'vitest'
import { parseAsrResult } from './asr'  // 纯解析函数，便于测

describe('parseAsrResult', () => {
  it('从 DashScope 结果提取全文与句级时间戳', () => {
    const raw = { sentences: [
      { text: '第一句', begin_time: 0, end_time: 1200 },
      { text: '第二句', begin_time: 1200, end_time: 2600 },
    ]}
    const r = parseAsrResult(raw)
    expect(r.fullText).toBe('第一句第二句')
    expect(r.sentences[1]).toEqual({ text: '第二句', startMs: 1200, endMs: 2600 })
  })
})
```
> 字段名（`begin_time/end_time` vs `start/end`）以 Step 0 核对结果为准，测试与实现同步改。

- [ ] **Step 2: 跑测试确认失败** — `parseAsrResult is not a function`

- [ ] **Step 3: 实现 dashscopeAsync.ts + asr.ts DashScope 分支 + parseAsrResult**

```ts
// packages/db/src/ai/dashscopeAsync.ts
export async function dashAsyncSubmit(url: string, apiKey: string, body: unknown): Promise<string> {
  const res = await fetch(url, { method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}`, 'X-DashScope-Async': 'enable' },
    body: JSON.stringify(body) })
  const j = await res.json()
  const taskId = j?.output?.task_id
  if (!res.ok || !taskId) throw new Error(`ASR 提交失败 ${res.status}: ${JSON.stringify(j).slice(0,300)}`)
  return taskId
}
export async function dashAsyncPoll(apiKey: string, taskId: string, o={intervalMs:3000,timeoutMs:600000}): Promise<any> {
  const started = Date.now()
  // 轮询用固定间隔；Date.now 仅在 worker（非 workflow 脚本）可用
  while (Date.now() - started < o.timeoutMs) {
    const res = await fetch(`https://dashscope.aliyuncs.com/api/v1/tasks/${taskId}`, { headers: { Authorization: `Bearer ${apiKey}` } })
    const j = await res.json()
    const st = j?.output?.task_status
    if (st === 'SUCCEEDED') return j.output
    if (st === 'FAILED') throw new Error(`ASR 任务失败: ${JSON.stringify(j).slice(0,300)}`)
    await new Promise(r => setTimeout(r, o.intervalMs))
  }
  throw new Error('ASR 轮询超时')
}
```
```ts
// packages/db/src/ai/asr.ts 关键片段
export function parseAsrResult(raw: any): { fullText: string; sentences: {text:string;startMs:number;endMs:number}[] } {
  const arr = raw?.sentences ?? []
  const sentences = arr.map((s: any) => ({ text: s.text, startMs: s.begin_time ?? s.start ?? 0, endMs: s.end_time ?? s.end ?? 0 }))
  return { fullText: sentences.map((s: {text:string}) => s.text).join(''), sentences }
}
// isDashScope 分支：优先 qwen-asr（同步 multimodal，复用 dashPost，audio URL）；
// 若 model 指向 paraformer/fun-asr → dashAsyncSubmit 到录音识别端点 + dashAsyncPoll + 取 transcription_url 下载 JSON → parseAsrResult
```

- [ ] **Step 4: transcribe.ts 真实调用**

`worker/src/gen/transcribe.ts`：抽取源音频（已有 wav）→ `publicAssetUrl(相对路径)` → `asrTranscribe({audioUrl})` → 写 `Transcript{ fullText, sentences }`。mock 分支保留（本地）。

- [ ] **Step 5: 跑解析测试 + tsc**

Run: `docker compose exec -T web sh -lc "cd /app && npx vitest run packages/db/src/ai/asr.test.ts" && npx tsc -p worker/tsconfig.json --noEmit`

- [ ] **Step 6: 服务器真跑验证（本任务的真实验收）**
  - 部署后设有效 asr `model`（qwen-asr / paraformer-v2，以 Step 0 为准）+ `enabled=true`，上传一条源 → 拆解 → 查 `transcripts.full_text` 非空且 `sentences` 有时间戳。记录结果。

- [ ] **Step 7: 提交**

```bash
git add packages/db/src/ai/dashscopeAsync.ts packages/db/src/ai/asr.ts packages/db/src/ai/asr.test.ts worker/src/gen/transcribe.ts
git commit -m "feat(ai): 真 ASR 适配（qwen-asr 同步/paraformer 异步），产出带时间戳转写"
```

---

## Task 4: 真文案提炼 + 书目识别（D1 拆解侧）

用真转写让 `extractFramework` 提炼真实文案公式，并识别源中的书目（书名/作者）。

**Files:**
- Modify: `worker/src/gen/extractFramework.ts`
- Test: `worker/src/gen/extractFramework.test.ts`（mock LLM，验证 prompt 组织与解析）

**Interfaces:**
- Consumes: `Transcript.fullText`
- Produces: framework 写入真实 `frameworkText`；`overlayTemplate.books?: {title,author}[]`（识别到则填）

- [ ] **Step 1: 写失败测试**：给定含《书名》的转写，`extractBooks(transcript)` 返回 `[{title:'活下去的理由', author:'马特·海格'}]`（正则/LLM 二选一；纯正则部分可测）。
- [ ] **Step 2: 跑测试失败**
- [ ] **Step 3: 实现** `extractBooks`（先正则 `《([^》]+)》`+邻近作者；LLM 兜底），并把真实 `fullText` 传入 LLM 提炼 prompt（替换 mock 空文本路径）。
- [ ] **Step 4: 跑测试通过 + tsc**
- [ ] **Step 5: 提交** `feat(gen): 基于真转写提炼文案公式并识别书目`

---

## Task 5: 生成矩阵（D1 生成侧）

支持「手填书单」与「只给选题 LLM 自选」两种入口，按框架风格写逐句书评文案。

**Files:**
- Modify: `worker/src/gen/generateScript.ts`
- Modify: `web/app/admin/generate` 生成表单（增加「书单模式/选题模式」+ 书单录入）
- Modify: `web/app/api/generate` 提交接口（接收 `variables.books`）
- Test: `worker/src/gen/generateScript.test.ts`（mock LLM，验证两模式 prompt 分支）

**Interfaces:**
- Consumes: `GenerationTask.subject`、`variables.books?: {title,author,points?}[]`、framework 风格字段
- Produces: `generated_segments`（每段 scriptText；书单模式下按 book 分组、每本多段）

- [ ] **Step 1: 写失败测试**：`buildScriptPrompt({mode:'books', books:[...], framework})` 含书名/作者与"逐句、书评口吻、每段≤N字"；`mode:'subject'` 含"先选书再写"。
- [ ] **Step 2: 跑测试失败**
- [ ] **Step 3: 实现** 两模式 prompt 分支 + 解析（书单模式产出按 book 分组，写入 `GeneratedSegment`，书名/作者暂存 `variables`/后续 M2 落字段）。
- [ ] **Step 4: 前端**：生成页加模式切换与书单录入（书名/作者/要点行）；提交写入 `variables.books`。
- [ ] **Step 5: 跑测试 + tsc + 本地 mock 跑通一条**（books 模式，mock LLM→ASSET_READY）
- [ ] **Step 6: 提交** `feat(gen): 生成矩阵（手填书单/选题自选）`

---

## Task 6: 声音复刻适配器 + 数据（D2 核心）

CosyVoice 声音复刻：建音色 + 用克隆音色合成。

**Files:**
- Modify: `packages/db/prisma/schema.prisma`（新增 `ClonedVoice`）+ 迁移
- Create: `packages/db/src/ai/voiceClone.ts`
- Modify: `packages/db/src/ai/tts.ts`（克隆音色分支）
- Test: `packages/db/src/ai/voiceClone.test.ts`（mock fetch 解析）

**Interfaces:**
- `ClonedVoice{ id, voiceId, name, sampleAssetUrl, provider @default("dashscope"), createdBy?, createdAt }`
- `enrollVoice(sampleUrl:string, name:string): Promise<{voiceId:string}>`、`parseEnrollResult(raw:any):{voiceId:string}`
- tts：当 `cfg.extra.voiceId` 或 `opts.voiceId` 存在且模型为 CosyVoice → 用 `voice=voiceId` 合成

- [ ] **Step 0（前置）**：WebFetch `https://help.aliyun.com/zh/model-studio/voice-cloning-user-guide` 与 CosyVoice 复刻 API，核对 `voice-enrollment`/`create_voice` 字段、目标模型 id、合成时传 voice 的方式。
- [ ] **Step 1: 写失败测试**：`parseEnrollResult({output:{voice_id:'v-123'}})` → `{voiceId:'v-123'}`。
- [ ] **Step 2: 跑测试失败**
- [ ] **Step 3: 实现** schema+迁移、`voiceClone.ts`（enroll 走原生端点，参数以 Step 0 为准）、`tts.ts` 克隆分支（保留 qwen-tts 与 mock 分支；整篇仍分段合成）。
- [ ] **Step 4: 迁移 + 解析测试 + tsc**
  Run: `docker compose exec -T web sh -lc "cd /app && npx prisma migrate dev --name add_cloned_voice --schema packages/db/prisma/schema.prisma && npx vitest run packages/db/src/ai/voiceClone.test.ts"`
- [ ] **Step 5: 服务器真跑验证**：喂一段源音频 URL → enroll 得 voiceId → 用它合成一段 → 听感为克隆音色。
- [ ] **Step 6: 提交** `feat(ai): CosyVoice 声音复刻（建音色+克隆音色合成）`

---

## Task 7: 声音复刻后台 UI（D2 界面）

运营克隆/管理音色，框架可选音色；复刻流程一键用源音频克隆。

**Files:**
- Create: `web/app/admin/voices/page.tsx`
- Create: `web/app/api/admin/voices/route.ts`（GET 列表 / POST 克隆）
- Modify: 框架编辑页（`web/app/admin/frameworks` 或 generate 相关）增加"音色"选择，写入 framework/generation 配置
- Modify: 拆解结果页 增「用此声音克隆」按钮（传源音频 `publicAssetUrl`）

**Interfaces:**
- Consumes: `enrollVoice`、`listVoices`（读 `ClonedVoice`）

- [ ] **Step 1**：API 路由 GET（列 ClonedVoice）/ POST（`{sampleAssetUrl,name}`→enrollVoice→存库）。
- [ ] **Step 2**：/admin/voices 页：列表 + 上传/选取样本 + 命名 + 克隆按钮（调 POST）。
- [ ] **Step 3**：框架侧选音色（存 `framework` 或 `generation` 的音色引用）；拆解结果页「用此声音克隆」。
- [ ] **Step 4**：本地 mock 跑通交互（mock enroll 返回假 voiceId）；tsc + `npm run build -w web`。
- [ ] **Step 5: 提交** `feat(web): 声音复刻后台（克隆/管理/选用音色）`

---

## M1 收尾

- [ ] 全量测试：`docker compose exec -T web sh -lc "cd /app && npm test"` 全绿
- [ ] 本地 mock 端到端：拆解（mock ASR）→ 生成（books 模式）→ ASSET_READY → 确认合成 → PREVIEW_PENDING
- [ ] 推服务器真跑 M1 验收（§设计 8.M1）：真 ASR 转写、真文案、克隆音色出片到 EXPORTED
- [ ] 更新 README / docs（新增能力、env、生成模式、声音复刻用法）

---

# 里程碑 M2：画面像 + 节奏像（大纲，M1 落定后细化）

> M2 含 vision 模型接入与模板版式重做，不确定性较高。以下为任务边界与方向；进入 M2 前，为每个任务补齐 TDD 步骤与完整代码（同 M1 粒度），并先 WebFetch qwen-vl 文档核对接口。

## Task 8: vision 能力 + 拆解画风识别
- **Files**: `packages/db/src/ai/vision.ts`（新，qwen-vl 多模态，输入帧 URL）；`worker/src/gen/extractStyle.ts`（新，抽样帧→vision→风格描述）；`extractFramework` 接入。
- **产出**：`imageStylePrompt`（如"厚涂油画、调色刀质感、情绪化、暗调/暖调随书"）、`visualStyleType`（如 `oil_painting`）、版式信息写 `overlayTemplate`。
- **验收**：对 be9f384c 识别出"油画/书名压顶/双语字幕/水印"版式。

## Task 9: 书名/作者压字 + 书单号模板版式
- **Files**: `schema.prisma`（`GeneratedSegment` 增 `bookTitle?/bookAuthor?`）+ 迁移；`worker/templates/booklist/*`（或新 `shudan` 模板）改版式：书名头常驻 + 满屏图 + 下三分中英双语 + 水印；`renderVisuals`/`generateImage` 用识别出的 `imageStylePrompt`，同书统一风格。
- **验收**：成片版式/画风与源同家族。

## Task 10: 节奏对齐
- **Files**: `worker/src/gen/*`（`bodyTimings` 生成）；从 `Transcript.sentences` + `SceneCut.cutPointsMs` 提取源节奏写入框架（`pace`）。
- **产出**：每段目标时长在 TTS 实际时长与源节奏间对齐。
- **验收**：段落节奏接近源。

## M2 收尾
- [ ] 服务器真跑 M2 验收（§设计 8.M2）：版式/画风/节奏对齐，主观相似度显著提升
- [ ] 更新 README / docs

---

## Self-Review（作者自查）

- **Spec 覆盖**：F1/F2/F3/D1/D2 → Task 1–7；D3/D4 → Task 8–10。全覆盖。
- **占位符**：API 精确字段以「Step 0 WebFetch 核对」显式前置，非占位遗漏；确定性逻辑（字数、签名、prompt 结构、schema）均给完整代码。
- **类型一致**：`deriveCharBudget`、`parseAsrResult`、`signAssetPath/verifyAssetToken`、`enrollVoice/parseEnrollResult` 在定义与调用处签名一致。
- **右尺寸**：每 Task 独立可测/可评审；地基（1–3）先行，功能（4–7）依赖其上。
- **现实约束**：DashScope 真实路径本地不可测 → 解析层 TDD + 服务器真跑验收，已在相应 Task 标注。
