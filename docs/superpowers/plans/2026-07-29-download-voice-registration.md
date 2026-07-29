# 下载可靠性 + 配音音色选择/试听 + 注册开关 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use `- [ ]`.

**Goal:** 三件一批：① 视频下载加下载头 + 压小体积；② 生成任务时可试听/选择配音音色；③ 注册默认关闭（邀请制）+ 后台开关。

**Architecture:** 复用现有 `/api/files`、`renderVideo`、`generateTts`、`ttsSynthesize`、`/api/auth/*`、`/admin/settings`。一条加列迁移（`smtp_config.registration_open`）。

**Tech Stack:** Next.js（web）+ Node worker + Prisma/Postgres + vitest。

## Global Constraints
- 向后兼容：`?download=1` 不带时行为不变；`variables.voice` 缺省走默认音色；`registration_open` 默认 `false`。
- 一条加列迁移（`registration_open`），加列安全、幂等。
- 纯函数可单测；现有全部测试回归绿；`tsc` 干净。
- 不动剪辑模板/生成主流程之外的逻辑。

## File Structure
| 文件 | 动作 | 模块 |
|---|---|---|
| `web/lib/contentDisposition.ts` | 新增 | A 安全文件名头（纯） |
| `web/app/api/files/[...path]/route.ts` | 改 | A `?download=1` → 下载头 |
| `web/app/(student)/library/page.tsx` | 改 | A 下载链接加 `?download=1` |
| `worker/src/gen/renderVideo.ts` | 改 | A `-crf 28` |
| `packages/db/src/ai/ttsVoices.ts` | 新增 | B 音色白名单常量 |
| `worker/src/gen/generateTts.ts` | 改 | B `readVoice` + 透传 voice |
| `packages/db/src/ai/types.ts` | 改(按需) | B TtsOpts 加 `voice?` |
| `web/app/api/tts/preview/route.ts` | 新增 | B 试听接口 |
| `web/app/admin/generate/page.tsx` | 改 | B 音色选择+试听 UI |
| `packages/db/prisma/schema.prisma` + migration | 改+新增 | C `registration_open` |
| `web/app/api/auth/config/route.ts` | 改 | C 暴露 registrationOpen |
| `web/app/api/auth/register/route.ts`、`send-code/route.ts` | 改 | C 门控 |
| `web/app/admin/settings/*` + 其保存 API | 改 | C 后台开关 |
| `web/app/(auth)/login/page.tsx` | 改 | C 关闭时隐藏注册标签 |

---

## Task 1（A）：下载头 Content-Disposition + 成片库下载链接

**Files:** Create `web/lib/contentDisposition.ts` + test；Modify `web/app/api/files/[...path]/route.ts`、`web/app/(student)/library/page.tsx`

**Interfaces (Produces):** `contentDispositionAttachment(filename: string): string` — 返回形如 `attachment; filename="x.mp4"; filename*=UTF-8''<pct>`，ASCII 回退安全。

- [ ] Step 1 失败测试
```ts
// web/lib/contentDisposition.test.ts
import { describe, it, expect } from 'vitest'
import { contentDispositionAttachment } from './contentDisposition'
describe('contentDispositionAttachment', () => {
  it('纯 ASCII 文件名', () => {
    expect(contentDispositionAttachment('final.mp4')).toContain('attachment; filename="final.mp4"')
  })
  it('中文文件名用 filename* UTF-8 编码', () => {
    const s = contentDispositionAttachment('活着.mp4')
    expect(s).toContain('attachment;')
    expect(s).toContain("filename*=UTF-8''")
    expect(s).toContain(encodeURIComponent('活着.mp4'))
  })
  it('去掉换行/引号等危险字符', () => {
    expect(contentDispositionAttachment('a"b\n.mp4')).not.toContain('\n')
    expect(contentDispositionAttachment('a"b\n.mp4')).not.toContain('"b')
  })
})
```
- [ ] Step 2 运行失败：`npx vitest run web/lib/contentDisposition.test.ts`
- [ ] Step 3 实现
```ts
// web/lib/contentDisposition.ts
// 生成安全的 Content-Disposition: attachment 头。ASCII 名放 filename，非 ASCII 走 filename*（RFC 5987）。
export function contentDispositionAttachment(filename: string): string {
  const clean = String(filename ?? 'download').replace(/[\r\n"]/g, '').trim() || 'download'
  const ascii = clean.replace(/[^\x20-\x7E]/g, '_') // 非 ASCII 回退占位
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(clean)}`
}
```
- [ ] Step 4 `/api/files` 路由改：在 GET 里读 `req.nextUrl.searchParams.get('download')`，为真时给**内联与 range 两个返回分支**都加 header `'Content-Disposition': contentDispositionAttachment(path.basename(abs))`（其余不变）。import `contentDispositionAttachment` from `@/lib/contentDisposition`。
- [ ] Step 5 `library/page.tsx`：下载链接 href 由 `w.videoUrl` 改为 `` `${w.videoUrl}?download=1` ``（字幕同理 `?download=1`）；`<video src={w.videoUrl}>` **不加**（保持内联播放）。
- [ ] Step 6 运行通过 + `npm run build -w web`（忽略已知 postgres 静态生成告警）
- [ ] Step 7 提交 `feat(web): 视频下载加 Content-Disposition(?download=1) 修移动端文件名/下载`

---

## Task 2（A）：成片压小体积（-crf 28）

**Files:** Modify `worker/src/gen/renderVideo.ts`；Test `renderVideo.sfx.test.ts`（追加）

- [ ] Step 1 追加失败测试
```ts
it('编码加 -crf 28 压小体积', () => {
  const a = buildFfmpegArgs({ bodyAbs:'b.mp4', audioAbs:'a.wav', bgmAbs:null, durSec:10, outAbs:'o.mp4' }).join(' ')
  expect(a).toContain('-crf 28')
})
```
- [ ] Step 2 运行失败
- [ ] Step 3 实现：`buildFfmpegArgs` 的 libx264 参数加 `'-crf', '28'`（放在 `-preset veryfast` 之后）。
- [ ] Step 4 运行通过 + `tsc`
- [ ] Step 5 提交 `perf(render): 成片编码 -crf 28 压小体积(慢网更易下完)`

---

## Task 3（B）：音色白名单 + generateTts 透传 voice

**Files:** Create `packages/db/src/ai/ttsVoices.ts` + test；Modify `packages/db/src/ai/index.ts`(导出)、`packages/db/src/ai/types.ts`(TtsOpts 加 voice?)、`worker/src/gen/generateTts.ts`(readVoice + 透传)；Test `generateTts.test.ts`(追加 readVoice)

**Interfaces (Produces):**
- `interface TtsVoice { id: string; label: string }`
- `const TTS_VOICES: TtsVoice[]`（候选：`Cherry/Serena/Ethan/Chelsie`，label 占位"知性女声/男声…"，部署后试听锁定）
- `isValidVoice(id: unknown): id is string`（在白名单内）
- `readVoice(variables: unknown): string | undefined`（取 `variables.voice` 且在白名单内）

- [ ] Step 1 失败测试
```ts
// packages/db/src/ai/ttsVoices.test.ts
import { describe, it, expect } from 'vitest'
import { TTS_VOICES, isValidVoice } from './ttsVoices'
describe('ttsVoices', () => {
  it('清单非空、每项有 id/label', () => {
    expect(TTS_VOICES.length).toBeGreaterThan(0)
    for (const v of TTS_VOICES) { expect(typeof v.id).toBe('string'); expect(typeof v.label).toBe('string') }
  })
  it('isValidVoice 只认白名单', () => {
    expect(isValidVoice(TTS_VOICES[0].id)).toBe(true)
    expect(isValidVoice('不存在')).toBe(false)
    expect(isValidVoice(123)).toBe(false)
  })
})
```
```ts
// 追加到 worker/src/gen/generateTts.test.ts
import { readVoice } from './generateTts'
describe('readVoice', () => {
  it('白名单内的 voice 原样返回，否则 undefined', () => {
    expect(readVoice({ voice: 'Cherry' })).toBe('Cherry')
    expect(readVoice({ voice: '乱填' })).toBeUndefined()
    expect(readVoice({})).toBeUndefined()
    expect(readVoice(null)).toBeUndefined()
  })
})
```
- [ ] Step 2 运行失败
- [ ] Step 3 实现
```ts
// packages/db/src/ai/ttsVoices.ts
// 配音音色白名单（qwen-tts 候选；label 部署后试听锁定）。选择/试听都只认此表，防注入。
export interface TtsVoice { id: string; label: string }
export const TTS_VOICES: TtsVoice[] = [
  { id: 'Cherry', label: '知性女声（Cherry）' },
  { id: 'Serena', label: '温柔女声（Serena）' },
  { id: 'Ethan', label: '磁性男声（Ethan）' },
  { id: 'Chelsie', label: '清亮女声（Chelsie）' },
]
export function isValidVoice(id: unknown): id is string {
  return typeof id === 'string' && TTS_VOICES.some((v) => v.id === id)
}
```
- `packages/db/src/ai/index.ts` 导出 `TTS_VOICES, isValidVoice, type TtsVoice`。
- `packages/db/src/ai/types.ts`：确认 `TtsOpts` 含 `voice?: string`，缺则补。
- `generateTts.ts`：加 `export function readVoice(variables): string|undefined`（用 `isValidVoice`）；主流程取 `const voice = readVoice(task?.variables)`，`ttsSynthesize({ text, ...(voiceId?{voiceId}:{}) , ...(voice?{voice}:{}) })`（voiceId 克隆优先级不变；普通 voice 并存透传）。
- [ ] Step 4 运行通过 + `tsc -p worker` + `tsc`(db)
- [ ] Step 5 提交 `feat(tts): 音色白名单 TTS_VOICES + generateTts 透传 variables.voice`

---

## Task 4（B）：试听接口 /api/tts/preview

**Files:** Create `web/app/api/tts/preview/route.ts`

**Interfaces:** `POST /api/tts/preview {voice}` → operator 鉴权 + 限流 + `isValidVoice` 校验 → `ttsSynthesize({text:固定示例, voice})` → 返回 `audio/mpeg`。

- [ ] Step 1 实现（无独立单测，逻辑简单；靠白名单/鉴权组合，集成在 Task 8 验）
```ts
// web/app/api/tts/preview/route.ts
import { ttsSynthesize, isValidVoice } from '@mixcut/db'
import { requireRole, HttpError } from '@/lib/auth'
import { handler } from '@/lib/api'
import { checkRate } from '@/lib/ratelimit'

const SAMPLE = '今天分享的是活着，一段温柔而有力量的人生感悟。'
export const POST = handler(async (req) => {
  const s = await requireRole('operator')
  checkRate('tts-preview', s.userId, 20)
  const { voice } = await req.json().catch(() => { throw new HttpError(400, '请求体格式错误') })
  if (!isValidVoice(voice)) throw new HttpError(400, '未知音色')
  const audio = await ttsSynthesize({ text: SAMPLE, voice })
  return new Response(audio as unknown as BodyInit, { headers: { 'Content-Type': 'audio/mpeg', 'Cache-Control': 'no-store' } })
})
```
- [ ] Step 2 `tsc` / `npm run build -w web` 通过
- [ ] Step 3 提交 `feat(web): 配音音色试听接口 /api/tts/preview(运营,白名单,限流)`

---

## Task 5（B）：生成表单音色选择 + 试听 UI

**Files:** Modify `web/app/admin/generate/page.tsx`

- [ ] Step 1 定位生成表单 variables 组装处（Task 前序已加 scriptMode/customScript/bookTitle）。
- [ ] Step 2 加 UI：
  - 拉取音色清单（可前端内置 `TTS_VOICES` 的镜像常量，或加 `GET /api/tts/preview` 返回列表——从简用前端内置常量数组，与 db 保持一致）。
  - 「配音音色」选择器（单选）：state `voice`（默认空=系统默认）。
  - 每个音色一个「试听」按钮：`POST /api/tts/preview {voice}` → `URL.createObjectURL(blob)` → `new Audio(url).play()`（播放中禁用、限一次）。
  - 提交：`variables` 加 `...(voice ? { voice } : {})`。
- [ ] Step 3 `npm run build -w web` 通过
- [ ] Step 4 提交 `feat(web): 生成表单加配音音色选择+试听`

---

## Task 6（C）：迁移 registration_open + 后端门控

**Files:** Modify `packages/db/prisma/schema.prisma` + 新增 migration；Modify `web/app/api/auth/config/route.ts`、`register/route.ts`、`send-code/route.ts`；设置保存 API（定位后加字段）

- [ ] Step 1 schema：`SmtpConfig` 加 `registrationOpen Boolean @default(false) @map("registration_open")`。
- [ ] Step 2 建迁移目录 `packages/db/prisma/migrations/20260729120000_add_registration_open/migration.sql`：
```sql
ALTER TABLE "smtp_config" ADD COLUMN "registration_open" BOOLEAN NOT NULL DEFAULT false;
```
  应用到本地测试库：`DATABASE_URL=...mixcut_test npx prisma migrate deploy --schema packages/db/prisma/schema.prisma`；`npx prisma generate --schema packages/db/prisma/schema.prisma`。
- [ ] Step 3 纯读函数（可测）：`export async function registrationOpen(): Promise<boolean>`（读 smtp_config.id=1 的 registration_open，缺行→false）放 `web/lib`（或复用现有 config 读取处）。
- [ ] Step 4 `/api/auth/config`：返回体加 `registrationOpen: await registrationOpen()`。
- [ ] Step 5 `register` + `send-code`（register 场景）：处理前 `if (!(await registrationOpen())) throw new HttpError(403, '注册未开放')`。forgot/reset 不动。
- [ ] Step 6 设置保存 API（`grep -rn "smtp" web/app/api web/app/admin` 定位读写 smtp_config 的接口）：读返回加 `registrationOpen`，写接受并更新该字段。
- [ ] Step 7 测试：register/send-code 在关闭时 403（mock registrationOpen=false）；config 返回含字段。`tsc` + `npm run build -w web`。
- [ ] Step 8 提交 `feat(auth): 注册开关(默认关)——迁移+config暴露+register/send-code门控`

---

## Task 7（C）：后台开关 UI + 登录页隐藏注册

**Files:** Modify `web/app/admin/settings/page.tsx`、`web/app/(auth)/login/page.tsx`

- [ ] Step 1 `admin/settings`：加「开放注册」开关（读/写 registrationOpen，走 Task6 的设置 API）。
- [ ] Step 2 `login/page.tsx`：已 `fetch /api/auth/config`（取 emailEnabled）→ 同时取 `registrationOpen`；`registrationOpen===false` 时**不渲染「注册」标签**（`views` 数组按开关过滤），只留登录（找回密码保留）。默认（未取到）按关闭处理（更安全）。
- [ ] Step 3 `npm run build -w web` 通过
- [ ] Step 4 提交 `feat(web): 后台开放注册开关 + 登录页按开关隐藏注册标签`

---

## Task 8：本地集成验收

- [ ] `/api/files ...?download=1` 返回含 `Content-Disposition: attachment`（curl 本地 web dev 或单测已覆盖）。
- [ ] 生成任务传 `variables.voice` → generated 段配音用该音色（mock 断言透传；真音色部署后试听）。
- [ ] 注册关闭时 `/api/auth/register` 返回 403、登录页无注册标签；后台开关打开后可注册。
- [ ] 全量测试绿（测试库）：`DATABASE_URL=...mixcut_test npx vitest run`；`npm run build -w web`。
- [ ] 文档追加实测结论 + 提交。

---

## Self-Review
- 覆盖：A 下载头(T1)+压体积(T2)；B 白名单/透传(T3)+试听(T4)+UI(T5)；C 迁移/门控(T6)+UI(T7)；验收(T8)。✅
- 无占位：每 code step 有完整代码或明确定位指引（T5/T6/T7 前端/设置 API 需 grep 定位，已给指引）。
- 类型一致：`isValidVoice`/`TTS_VOICES`/`readVoice`/`contentDispositionAttachment`/`registrationOpen` 定义与调用一致；`variables.voice` 由 T5 写、T3 读；`registration_open` 由 T6 迁移/读、T7 UI 写。
- 迁移仅一条加列，安全幂等。
