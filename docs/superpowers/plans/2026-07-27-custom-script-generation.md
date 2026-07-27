# 自定义文案生成 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** 生成入口支持三种文案来源——`manual`(粘贴文案,按标点切分镜,跳过LLM) / `imitate`(参考仿写) / `auto`(现状,默认)，并支持每条单独填「书名标题」。文案可控，剪辑框架复用。

**Architecture:** 参数存 `generationTask.variables`（无迁移）。web 生成入参加字段并放宽 subject；worker `generateScript` 按 `scriptMode` 分支；新增纯函数切分镜 + 仿写提示词。配图/配音/对齐/渲染/模板全部复用不动。

**Tech Stack:** TypeScript + vitest；Next.js（web 表单/API）；worker 生成链。

## Global Constraints

- **向后兼容**：`scriptMode` 缺省 = `auto`，走现有全自动路径，行为不变；现有全部测试回归绿。
- **无数据库迁移**：新入参存 `variables`：`scriptMode`('auto'|'manual'|'imitate') / `customScript`(string) / `bookTitle`(string)。
- **manual 模式完全不调 LLM**。
- 纯函数（切分镜/仿写提示词/normalize）必须可单测。
- 不动剪辑模板（flash/classic）、不动配图/配音/对齐/渲染逻辑。

## File Structure

| 文件 | 动作 | 职责 |
|---|---|---|
| `worker/src/gen/splitScript.ts` | 新增 | `splitScriptToSegments` 按标点切分镜（纯） |
| `worker/src/gen/generateScript.ts` | 改 | `buildImitatePrompt`（纯）+ 主流程按 scriptMode 分支 + per-gen bookTitle |
| `web/app/api/generate/normalize.ts` | 改 | 收 scriptMode/customScript/bookTitle（校验） |
| `web/app/api/generate/route.ts` | 改 | manual/imitate 放宽 subject（可空，兜底派生） |
| `web/app/admin/generate/page.tsx` | 改 | 文案来源单选 + 文案框 + 书名标题字段 |

---

## Task 1: 切分镜纯函数 splitScript.ts

**Files:**
- Create: `worker/src/gen/splitScript.ts`
- Test: `worker/src/gen/splitScript.test.ts`

**Interfaces (Produces):**
- `splitScriptToSegments(text: string): string[]` — 按句末标点 `。！？!?；;` 与换行切分镜，去首尾空白、丢空段，句内不再切（保留原句文本，去掉结尾切分标点）。

- [ ] **Step 1: 写失败测试**

```ts
// worker/src/gen/splitScript.test.ts
import { describe, it, expect } from 'vitest'
import { splitScriptToSegments } from './splitScript'

describe('splitScriptToSegments', () => {
  it('按句号/问号/感叹号切分镜', () => {
    expect(splitScriptToSegments('第一句。第二句！第三句？')).toEqual(['第一句', '第二句', '第三句'])
  })
  it('按换行切分镜', () => {
    expect(splitScriptToSegments('第一行\n第二行\n\n第三行')).toEqual(['第一行', '第二行', '第三行'])
  })
  it('分号/中英标点混用', () => {
    expect(splitScriptToSegments('a；b;c。d?')).toEqual(['a', 'b', 'c', 'd'])
  })
  it('去首尾空白、丢空段', () => {
    expect(splitScriptToSegments('  句一 。  \n \n 句二。')).toEqual(['句一', '句二'])
  })
  it('句内逗号不切（留给 captionBeats）', () => {
    expect(splitScriptToSegments('前半，后半。下一句。')).toEqual(['前半，后半', '下一句'])
  })
  it('空/纯标点 → []', () => {
    expect(splitScriptToSegments('')).toEqual([])
    expect(splitScriptToSegments('。！？\n')).toEqual([])
    expect(splitScriptToSegments('   ')).toEqual([])
  })
})
```

- [ ] **Step 2: 运行确认失败** — `npx vitest run worker/src/gen/splitScript.test.ts` → FAIL

- [ ] **Step 3: 实现**

```ts
// worker/src/gen/splitScript.ts
// 把整段文案按「句末标点 + 换行」切成分镜（每个分镜=一句=一图一配音）。
// 句内逗号不切——句内节奏由下游 splitCaptionPhrases 按逗号切成字幕节拍。纯函数。
export function splitScriptToSegments(text: string): string[] {
  return String(text ?? '')
    .split(/[。！？!?；;\n]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
}
```

- [ ] **Step 4: 运行确认通过** — PASS
- [ ] **Step 5: 提交** — `git add worker/src/gen/splitScript.* && git commit -m "feat(gen): 文案按标点切分镜 splitScript.ts"`

---

## Task 2: 仿写提示词 buildImitatePrompt

**Files:**
- Modify: `worker/src/gen/generateScript.ts`（追加导出纯函数）
- Test: `worker/src/gen/generateScript.imitate.test.ts`

**Interfaces:**
- Consumes: 现有 `STYLE_RULES`（模块内常量）、`ScriptFrameworkInput` 类型
- Produces: `buildImitatePrompt(args: { reference: string; subject: string; framework: { frameworkText: string; segCount: number; maxLines: number; maxTotalChars: number } }): string`

- [ ] **Step 1: 写失败测试**

```ts
// worker/src/gen/generateScript.imitate.test.ts
import { describe, it, expect } from 'vitest'
import { buildImitatePrompt } from './generateScript'

const fw = { frameworkText: '框架说明', segCount: 6, maxLines: 21, maxTotalChars: 220 }

describe('buildImitatePrompt', () => {
  const p = buildImitatePrompt({ reference: '一生中与你相处时间最长的就是你自己。', subject: '自我接纳', framework: fw })
  it('包含参考文案与"仿写/模仿"指令', () => {
    expect(p).toContain('一生中与你相处时间最长的就是你自己')
    expect(p).toMatch(/仿写|模仿|照.*风格/)
  })
  it('要求原创改写、不照抄参考', () => {
    expect(p).toMatch(/不.*照抄|原创改写/)
  })
  it('带字数/行数预算与风格准则(无CTA)', () => {
    expect(p).toContain('220')
    expect(p).toContain('21')
    expect(p).toMatch(/CTA|购物车|关注/) // STYLE_RULES 里的禁 CTA 条款
  })
})
```

- [ ] **Step 2: 运行确认失败** — FAIL（未导出 buildImitatePrompt）

- [ ] **Step 3: 实现（在 generateScript.ts 追加，复用 STYLE_RULES）**

```ts
// 追加到 worker/src/gen/generateScript.ts（STYLE_RULES 定义之后、导出）
export function buildImitatePrompt(args: {
  reference: string
  subject: string
  framework: { frameworkText: string; segCount: number; maxLines: number; maxTotalChars: number }
}): string {
  const { reference, subject, framework } = args
  const { frameworkText, segCount, maxLines, maxTotalChars } = framework
  return [
    '你是一名书单号短视频文案写手。请【仿照】下面这段【参考文案】的语气、句式、情感浓度与第二人称口吻，就同一主题原创改写一条新文案。',
    '',
    `参考文案（模仿其风格与节奏，不要照抄内容）：\n${reference}`,
    `主题：${subject}`,
    `文案框架：\n${frameworkText}`,
    '',
    '要求：',
    `1. 分成约 ${segCount} 段，每句单独一行；第二人称口吻，围绕一个核心主题贯穿，不逐本介绍、不讲故事情节。`,
    '2. 只输出文案正文，不要编号、不要标题、不要任何解释说明。',
    '3. 必须原创改写，严禁照抄参考文案或框架示例。',
    `4. 总字数不超过 ${maxTotalChars} 字，总行数不超过 ${maxLines} 行。`,
    '',
    STYLE_RULES,
  ].join('\n')
}
```

- [ ] **Step 4: 运行确认通过** — PASS
- [ ] **Step 5: 提交** — `git commit -m "feat(gen): 参考仿写提示词 buildImitatePrompt"`

---

## Task 3: web 生成入参（normalize + 放宽 subject）

**Files:**
- Modify: `web/app/api/generate/normalize.ts`
- Modify: `web/app/api/generate/route.ts`
- Test: `web/app/api/generate/normalize.test.ts`（追加）

**Interfaces:**
- `normalizeVariables` 增字段处理：
  - `scriptMode`：`'manual'|'imitate'` 原样保留，其余/缺省 → 不设（下游默认 auto）。
  - `customScript`：字符串；当 `scriptMode` ∈ {manual,imitate} 时必填非空（trim 后），否则抛 400；auto 时忽略。
  - `bookTitle`：字符串，trim；空则不设。
- route：manual/imitate 时 `subject` 允许空 → 用 `bookTitle` 或 customScript 首句兜底；auto 时仍要求 subject 非空。

- [ ] **Step 1: 追加失败测试**

```ts
// 追加到 web/app/api/generate/normalize.test.ts
import { normalizeVariables } from './normalize'

describe('normalizeVariables — 自定义文案', () => {
  it('manual 模式：保留 scriptMode/customScript/bookTitle(trim)', () => {
    const v = normalizeVariables({ scriptMode: 'manual', customScript: '  句一。句二。 ', bookTitle: ' 活着 ' })
    expect(v?.scriptMode).toBe('manual')
    expect(v?.customScript).toBe('句一。句二。')
    expect(v?.bookTitle).toBe('活着')
  })
  it('imitate 模式同样要求 customScript', () => {
    expect(() => normalizeVariables({ scriptMode: 'imitate', customScript: '   ' })).toThrow()
  })
  it('manual 缺 customScript → 400', () => {
    expect(() => normalizeVariables({ scriptMode: 'manual' })).toThrow()
  })
  it('非法 scriptMode → 视为 auto(不设 scriptMode)，customScript 被忽略', () => {
    const v = normalizeVariables({ scriptMode: 'weird', customScript: 'x' })
    expect(v?.scriptMode).toBeUndefined()
  })
  it('auto(无 scriptMode) 不受影响', () => {
    const v = normalizeVariables({ voiceId: 'v-1' })
    expect(v?.scriptMode).toBeUndefined()
    expect(v?.voiceId).toBe('v-1')
  })
})
```

- [ ] **Step 2: 运行确认失败** — `npx vitest run web/app/api/generate/normalize.test.ts` → FAIL

- [ ] **Step 3: 实现**

`normalize.ts` 的 `normalizeVariables` 内，`voiceId` 处理之后追加：
```ts
  // 文案来源：仅接受 manual/imitate，否则视为 auto（不设该字段，走全自动）。
  const mode = v.scriptMode
  if (mode === 'manual' || mode === 'imitate') {
    v.scriptMode = mode
    const cs = typeof v.customScript === 'string' ? v.customScript.trim() : ''
    if (!cs) throw new HttpError(400, '自定义/仿写模式需要提供文案')
    v.customScript = cs
  } else {
    delete v.scriptMode
    delete v.customScript
  }
  const bt = typeof v.bookTitle === 'string' ? v.bookTitle.trim() : ''
  if (bt) v.bookTitle = bt
  else delete v.bookTitle
```

`route.ts`：把「subject 非空」检查改为 mode 感知——先 normalize，再按 mode 校验/兜底 subject：
```ts
  // 原： if (!subject ...) throw 400  —— 改为：
  const normalizedVariables = normalizeVariables(variables)
  const mode = normalizedVariables?.scriptMode
  let finalSubject = typeof subject === 'string' ? subject.trim() : ''
  if (mode === 'manual' || mode === 'imitate') {
    // 选题可空：用书名或文案首句兜底（满足非空约束、列表页可读）
    if (!finalSubject) {
      const bt = typeof normalizedVariables?.bookTitle === 'string' ? normalizedVariables.bookTitle : ''
      const cs = typeof normalizedVariables?.customScript === 'string' ? normalizedVariables.customScript : ''
      finalSubject = (bt || cs.split(/[。！？!?；;\n]/)[0] || '自定义文案').trim().slice(0, 40)
    }
  } else if (!finalSubject) {
    throw new HttpError(400, '选题不能为空')
  }
```
（后续 `prisma.generationTask.create` 用 `subject: finalSubject`；`voiceId` 校验、其余不变。注意 normalizeVariables 调用移到 subject 校验之前。）

- [ ] **Step 4: 运行确认通过** — normalize 测试 PASS；`npx tsc --noEmit` web 侧构建无类型错（`npm run build -w web` 可选）
- [ ] **Step 5: 提交** — `git commit -m "feat(web): 生成入参支持 scriptMode/customScript/bookTitle + 放宽 subject"`

---

## Task 4: generateScript 按 scriptMode 分支 + per-gen 书名

**Files:**
- Modify: `worker/src/gen/generateScript.ts`
- Test: `worker/src/gen/generateScript.mode.test.ts`

**Interfaces:**
- Consumes: `splitScriptToSegments`（Task1）、`buildImitatePrompt`（Task2）
- Produces: `readScriptMode(variables): 'auto'|'manual'|'imitate'`、`readCustomScript(variables): string`、`readBookTitle(variables): string | undefined`（纯，导出便于测试）；主 `generateScript` 按 mode 分支。

- [ ] **Step 1: 写失败测试（纯读取器 + 切分数）**

```ts
// worker/src/gen/generateScript.mode.test.ts
import { describe, it, expect } from 'vitest'
import { readScriptMode, readCustomScript, readBookTitle } from './generateScript'
import { splitScriptToSegments } from './splitScript'

describe('readScriptMode/CustomScript/BookTitle', () => {
  it('manual/imitate 识别；其余 auto', () => {
    expect(readScriptMode({ scriptMode: 'manual' })).toBe('manual')
    expect(readScriptMode({ scriptMode: 'imitate' })).toBe('imitate')
    expect(readScriptMode({ scriptMode: 'weird' })).toBe('auto')
    expect(readScriptMode(null)).toBe('auto')
    expect(readScriptMode({})).toBe('auto')
  })
  it('customScript/bookTitle 读取', () => {
    expect(readCustomScript({ customScript: '句一。句二。' })).toBe('句一。句二。')
    expect(readCustomScript({})).toBe('')
    expect(readBookTitle({ bookTitle: '活着' })).toBe('活着')
    expect(readBookTitle({})).toBeUndefined()
  })
  it('manual 切分数 = 分镜数', () => {
    expect(splitScriptToSegments(readCustomScript({ customScript: '一。二。三。' })).length).toBe(3)
  })
})
```

- [ ] **Step 2: 运行确认失败** — FAIL

- [ ] **Step 3: 实现**

顶部 import 追加：`import { splitScriptToSegments } from './splitScript'`

追加读取器（纯）：
```ts
export function readScriptMode(variables: unknown): 'auto' | 'manual' | 'imitate' {
  const m = variables && typeof variables === 'object' && !Array.isArray(variables)
    ? (variables as Record<string, unknown>).scriptMode : undefined
  return m === 'manual' || m === 'imitate' ? m : 'auto'
}
export function readCustomScript(variables: unknown): string {
  const v = variables && typeof variables === 'object' && !Array.isArray(variables)
    ? (variables as Record<string, unknown>).customScript : undefined
  return typeof v === 'string' ? v : ''
}
export function readBookTitle(variables: unknown): string | undefined {
  const v = variables && typeof variables === 'object' && !Array.isArray(variables)
    ? (variables as Record<string, unknown>).bookTitle : undefined
  return typeof v === 'string' && v.trim() ? v.trim() : undefined
}
```

在 `generateScript` 主流程里，`resolveScriptMode` 那段之后、构建/调用 LLM 处，改为按 scriptMode 分派得到 `clean: string[]`：
```ts
  const scriptMode = readScriptMode(task.variables)
  const perGenBookTitle = readBookTitle(task.variables)

  let clean: string[] | null = null
  if (scriptMode === 'manual') {
    // 手动：直接切分用户文案，跳过 LLM / validate / 重试
    clean = splitScriptToSegments(readCustomScript(task.variables))
    if (clean.length === 0) {
      await setGenerationStatus(genTaskId, 'FAILED')
      throw new Error('自定义文案为空或无法切分')
    }
    // 安全上限：极端超预算仍裁剪（不硬失败）
    clean = trimToBudget(clean, maxLines, maxTotalChars)
  } else {
    // imitate: 用参考仿写；auto: 现状。二者复用现有 validate/重试/兜底循环。
    const basePrompt = scriptMode === 'imitate'
      ? buildImitatePrompt({ reference: readCustomScript(task.variables), subject: task.subject, framework: { frameworkText: fw.frameworkText, segCount, maxLines, maxTotalChars } })
      : buildScriptPrompt({ mode, subject: task.subject, books, framework: { frameworkText: fw.frameworkText, segCount, maxLines, maxTotalChars }, variablesText })
    // …（现有 for MAX_ATTEMPTS 循环 + 兜底 trimToBudget，产出 clean）…
  }
```
> 实现要点：把现有「`const basePrompt = buildScriptPrompt(...)` + 重试循环 + 兜底」整体挪进 `else` 分支，`basePrompt` 依 scriptMode 二选一；`clean` 在两分支都被赋值。manual 分支完全不进循环。

书名分配——`assignBooksToSegments` 之后，per-gen bookTitle 覆盖（优先级最高）：
```ts
  const assigned = assignBooksToSegments(clean, books ?? [])
  const assignedFinal = perGenBookTitle
    ? assigned.map((a) => ({ ...a, bookTitle: perGenBookTitle }))
    : assigned
  // 下游改用 assignedFinal 建 segments
```
（把后续遍历 `assigned` 改为 `assignedFinal`。）

- [ ] **Step 4: 运行确认通过** — mode 测试 PASS；`npx tsc --noEmit -p worker/tsconfig.json` exit 0
- [ ] **Step 5: 全量回归（需测试库）**
```
DATABASE_URL="postgresql://mixcut:mixcut@127.0.0.1:55433/mixcut_test" npx vitest run
```
Expected: 全绿（含现有 generateScript 测试回归——auto 分支不变）。
- [ ] **Step 6: 提交** — `git commit -m "feat(gen): generateScript 三模式分支(manual跳LLM/imitate仿写/auto) + per-gen 书名"`

---

## Task 5: Web 生成表单 UI

**Files:**
- Modify: `web/app/admin/generate/page.tsx`（若操作页在别处，按实际路径；实现者先定位生成表单组件）

**Interfaces:** 提交时 `variables` 带 `{ scriptMode, customScript, bookTitle }`；manual/imitate 时可不填 subject。

- [ ] **Step 1: 定位生成表单** — `grep -rn "api/generate" web/app --include=*.tsx`，找到发起生成的组件与其 `variables` 组装处。

- [ ] **Step 2: 加 UI（按现有表单风格）**
在表单里加：
- 「文案来源」单选：自动生成 / 手动粘贴 / 参考仿写（state `scriptMode`，默认 auto/自动）。
- 当 scriptMode ≠ auto：显示多行文本框（state `customScript`，placeholder：手动=「粘贴你的文案，按句号/换行分句」；仿写=「粘贴参考文案，AI 照风格仿写」）。
- 「书名标题（可选）」输入框（state `bookTitle`）。
- 提交组装：
```ts
const variables = {
  ...(existing),
  ...(scriptMode !== 'auto' ? { scriptMode, customScript } : {}),
  ...(bookTitle.trim() ? { bookTitle: bookTitle.trim() } : {}),
}
// auto 时 subject 仍必填；manual/imitate 时 subject 可空
```
遵循现有组件的提交/校验风格；auto 模式 UI 与行为保持原样。

- [ ] **Step 3: 手测 + 构建**
```
npm run build -w web    # 类型/构建通过
```
（若本地起服务可点一遍：切手动 → 粘贴文案 → 填书名 → 生成，确认请求体带 scriptMode/customScript/bookTitle。）

- [ ] **Step 4: 提交** — `git commit -m "feat(web): 生成表单加文案来源(手动/仿写/自动)+文案框+书名标题"`

---

## Task 6: 本地集成验收（manual 端到端）

**Files:** Temp（不入库）: `worker/__renderManual.ts` 或直接后台操作

**Interfaces:** 无（集成验证）

- [ ] **Step 1: 造 manual 任务**：本地对一段真实文案（如用户给的「活下去的理由」那段）以 manual 模式生成——可临时脚本构造 variables `{scriptMode:'manual', customScript:'…', bookTitle:'活下去的理由'}` 建 generationTask + 入队，或直接调 generateScript。
- [ ] **Step 2: 核对分镜**：`generated_segments` 段数 = 文案切分句数；`script_text` 逐字等于用户文案（未被 LLM 改写）；每段有 captionBeats；`book_title` = 书名标题。
- [ ] **Step 3: （可选）真渲染**一条看成片：书名标题显示、逐句字幕=用户文案、配图无人物、配音真人声。
- [ ] **Step 4: 清理临时脚本 + 文档追加实测结论**
- [ ] **Step 5: 提交** — `git commit -m "docs(gen): 自定义文案 manual 模式本地验收结论"`

---

## Self-Review

**Spec coverage:**
- manual 跳 LLM + 按标点切 → T1(切分) + T4(分支) ✅
- imitate 仿写 → T2(提示词) + T4(分支) ✅
- auto 现状 → T4 保留 + T4-Step5 回归 ✅
- per-gen 书名标题 → T3(入参) + T4(覆盖段 bookTitle，渲染侧复用现有 seg.bookTitle) ✅
- web 入参 + 放宽 subject → T3 ✅
- web 表单 UI → T5 ✅
- 向后兼容/无迁移 → 全程 variables，auto 默认 ✅
- 验收 → T6 ✅

**Placeholder scan:** 无 TBD；每 code step 有完整代码；T5 因是前端表单、路径需实现者定位（已给 grep 指引），非占位。

**Type consistency:**
- `splitScriptToSegments` T1 定义，T4/T3(route 兜底切句可复用同规则) 使用一致。
- `buildImitatePrompt(args{reference,subject,framework})` T2 定义，T4 调用一致。
- `readScriptMode/readCustomScript/readBookTitle` T4 定义并导出，T4 主流程使用一致。
- normalize 产出的 variables 字段（scriptMode/customScript/bookTitle）T3 定义，T4 读取一致。
- 渲染侧无需改：per-gen bookTitle 落到 `generated_segments.book_title`，`renderVisuals`/`indexHtml` 已渲染 seg.bookTitle（书名头/标题）。

无缺口。计划就绪。
