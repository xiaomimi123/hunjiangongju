# 邮箱注册 + SMTP 邮件基础设施 + PC 管理控制台 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 学员用邮箱自助注册登录；管理后台可配置并开关 SMTP，用于注册验证与忘密找回；运营/管理统一到一个 PC 桌面控制台，含「注册学员数据」页。

**Architecture:** 同一个 Next 14 应用，按角色分两套界面——移动端学员界面（仅改登录页）与 PC 桌面控制台（`/admin`，左侧边栏）。邮件发信在 web 侧用 nodemailer，配置存 DB 单条 `SmtpConfig`（密码 AES 加密），验证/重置码存 `EmailCode`（哈希、10 分钟、一次性）。

**Tech Stack:** Next.js 14 App Router、Prisma 5 + PostgreSQL、nodemailer、node:crypto（AES-256-GCM）、bcryptjs、jose(JWT)、Tailwind、vitest、Docker Compose。

## Global Constraints

- 上游设计：`docs/superpowers/specs/2026-07-10-auth-email-pc-console-design.md`（以它为准）。
- 邮箱作唯一账号标识；`User.email` 唯一，登录按邮箱。自助注册强制 `role='student'`。
- SMTP 总开关 `SmtpConfig.enabled` 同时决定「注册是否需验证」与「忘密是否可用」；`emailEnabled = enabled && host 非空`。
- 验证/重置码：6 位数字、有效期 10 分钟、SHA-256 哈希存储、一次性消费、同 `email+purpose` 旧码在发新码时作废。
- SMTP 密码 AES-256-GCM 加密存储，密钥由 `process.env.JWT_SECRET` 经 `scrypt` 派生；接口绝不回传明文密码。
- 所有 API 沿用现有封装：`handler`（`@/lib/api`）、`requireRole`/`HttpError`/`getSession`（`@/lib/auth`）、`prisma`（`@mixcut/db`）、`signToken`（`@/lib/jwt`）。JWT cookie 名固定 `token`，httpOnly。
- 复用现有移动端设计系统类（`web/app/globals.css`：`.card`/`.btn-primary`/`.btn-ghost`/`.field`/`.pill`+`pill-bad`/`.eyebrow`/`.grad`/`.grad-text`/`.num` 等）与组件（`@/components/ui` 的 `StatusPill`）。
- 运行命令统一：`docker compose -f docker-compose.yml -f docker-compose.dev.yml`（下文简写 `dc`）；容器内 `next build`/单测需 `NODE_ENV=production` 或宿主机 `npx vitest run`（dev 容器 `NODE_ENV=development` 会污染 `next build`）。
- 中文 UI；PC 控制台桌面优先（≥1024px 为主，窄屏可用即可）。
- 提交信息前缀 `feat:/fix:/test:/chore:/docs:`，中文描述，每任务至少一次提交。

---

### Task 1: Prisma schema —— User 邮箱/昵称 + SmtpConfig + EmailCode + 迁移

**Files:**
- Modify: `packages/db/prisma/schema.prisma`

**Interfaces:**
- Produces：`User.email`(unique)/`User.nickname`/`User.account`(改可空)；模型 `SmtpConfig`（单行 id=1）、`EmailCode`。后续任务按这些字段名读写。

- [ ] **Step 1: 改 User 模型**

在 `packages/db/prisma/schema.prisma` 的 `User` 模型中，把 `account` 改为可空并去唯一，新增 `email`、`nickname`：
```prisma
model User {
  id           String      @id @default(uuid())
  email        String      @unique
  nickname     String?
  account      String?     @map("account")
  passwordHash String      @map("password_hash")
  role         String      @default("student")
  createdAt    DateTime    @default(now()) @map("created_at")
  accessKeys   AccessKey[]
  tasks        Task[]

  @@map("users")
}
```

- [ ] **Step 2: 新增 SmtpConfig 与 EmailCode 模型**

在文件末尾（`@@map("exports")` 之后）追加：
```prisma
model SmtpConfig {
  id          Int      @id @default(1)
  host        String   @default("")
  port        Int      @default(465)
  secure      Boolean  @default(true)
  username    String   @default("")
  passwordEnc String   @default("") @map("password_enc")
  fromAddress String   @default("") @map("from_address")
  fromName    String   @default("投流工作台") @map("from_name")
  enabled     Boolean  @default(false)
  updatedAt   DateTime @updatedAt @map("updated_at")

  @@map("smtp_config")
}

model EmailCode {
  id         String    @id @default(uuid())
  email      String
  codeHash   String    @map("code_hash")
  purpose    String
  expiresAt  DateTime  @map("expires_at")
  consumedAt DateTime? @map("consumed_at")
  createdAt  DateTime  @default(now()) @map("created_at")

  @@index([email, purpose])
  @@map("email_codes")
}
```

- [ ] **Step 3: 容器内迁移 + 宿主机 generate**

Run: `dc exec web npx prisma migrate dev --schema packages/db/prisma/schema.prisma --name auth_email_smtp`
Expected: `Your database is now in sync with your schema`，生成迁移目录。

> 注意：现有 `users` 表已有数据（种子），新增 `email` 唯一非空列会因存量行为空而失败。若迁移报「column email of relation users contains null values」，先在迁移交互中允许，或因本地可直接重置：`dc exec web npx prisma migrate reset --schema packages/db/prisma/schema.prisma --force`（本地开发库，重置可接受；Task 10 会重新 seed）。

Run: `npx prisma generate --schema packages/db/prisma/schema.prisma`
Expected: `Generated Prisma Client`。

- [ ] **Step 4: Commit**

```bash
git add packages/db/prisma
git commit -m "feat: User 加邮箱/昵称，新增 SmtpConfig 与 EmailCode 模型及迁移"
```

---

### Task 2: 纯函数 —— AES 加解密 + 邮箱/验证码工具（TDD）

**Files:**
- Create: `web/lib/crypto.ts`、`web/lib/crypto.test.ts`
- Create: `web/lib/authcodes.ts`、`web/lib/authcodes.test.ts`

**Interfaces:**
- Produces:
  - `encrypt(plain: string): string`、`decrypt(data: string): string`（`web/lib/crypto.ts`，AES-256-GCM，base64）
  - `isEmail(s: string): boolean`、`genCode(): string`（6 位数字串）、`hashCode(code: string): string`（sha256 hex）（`web/lib/authcodes.ts`）

- [ ] **Step 1: 写失败测试**

`web/lib/crypto.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { encrypt, decrypt } from './crypto'

describe('AES 加解密', () => {
  it('round-trip 还原原文', () => {
    const s = 'super-secret-smtp-pass-你好'
    expect(decrypt(encrypt(s))).toBe(s)
  })
  it('相同明文两次密文不同（随机 IV）', () => {
    expect(encrypt('x')).not.toBe(encrypt('x'))
  })
  it('空串解密返回空串', () => {
    expect(decrypt('')).toBe('')
  })
})
```

`web/lib/authcodes.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { isEmail, genCode, hashCode } from './authcodes'

describe('邮箱校验', () => {
  it('合法邮箱', () => { expect(isEmail('a@b.com')).toBe(true) })
  it('非法邮箱', () => {
    expect(isEmail('a@b')).toBe(false)
    expect(isEmail('nope')).toBe(false)
    expect(isEmail('a b@c.com')).toBe(false)
  })
})
describe('验证码', () => {
  it('genCode 为 6 位数字', () => { expect(genCode()).toMatch(/^\d{6}$/) })
  it('hashCode 稳定且非明文', () => {
    expect(hashCode('123456')).toBe(hashCode('123456'))
    expect(hashCode('123456')).not.toContain('123456')
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run web/lib/crypto.test.ts web/lib/authcodes.test.ts`
Expected: FAIL（找不到模块）。

- [ ] **Step 3: 实现**

`web/lib/crypto.ts`:
```ts
import { scryptSync, randomBytes, createCipheriv, createDecipheriv } from 'crypto'

const key = () => scryptSync(process.env.JWT_SECRET ?? 'dev-secret', 'mixcut-smtp-salt', 32)

export function encrypt(plain: string): string {
  if (!plain) return ''
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key(), iv)
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return Buffer.concat([iv, tag, enc]).toString('base64')
}

export function decrypt(data: string): string {
  if (!data) return ''
  const buf = Buffer.from(data, 'base64')
  const iv = buf.subarray(0, 12)
  const tag = buf.subarray(12, 28)
  const enc = buf.subarray(28)
  const decipher = createDecipheriv('aes-256-gcm', key(), iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8')
}
```

`web/lib/authcodes.ts`:
```ts
import { randomInt, createHash } from 'crypto'

export function isEmail(s: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s ?? '')
}

export function genCode(): string {
  return String(randomInt(100000, 1000000))
}

export function hashCode(code: string): string {
  return createHash('sha256').update(String(code)).digest('hex')
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run web/lib/crypto.test.ts web/lib/authcodes.test.ts`
Expected: 全部 PASS。

- [ ] **Step 5: Commit**

```bash
git add web/lib/crypto.ts web/lib/crypto.test.ts web/lib/authcodes.ts web/lib/authcodes.test.ts
git commit -m "feat: AES 加解密与邮箱/验证码纯函数工具（含单测）"
```

---

### Task 3: 会话 cookie helper + 邮件发信与验证码存取

**Files:**
- Create: `web/lib/session.ts`、`web/lib/mailer.ts`、`web/lib/emailflow.ts`
- Modify: `web/package.json`（加 nodemailer 依赖）

**Interfaces:**
- Consumes: `prisma`、`signToken`（Task 前置）、`encrypt/decrypt`、`isEmail/genCode/hashCode`（Task 2）、`HttpError`
- Produces:
  - `setSessionCookie(res: NextResponse, session: { userId: string; role: string }): Promise<NextResponse>`（`session.ts`）
  - `emailEnabled(): Promise<boolean>`、`sendMail(to: string, subject: string, html: string): Promise<void>`、`sendTestMail(cfg, to): Promise<void>`（`mailer.ts`）
  - `sendCode(email: string, purpose: 'verify' | 'reset'): Promise<void>`、`consumeCode(email: string, code: string, purpose: 'verify' | 'reset'): Promise<void>`（`emailflow.ts`，失败抛 `HttpError(400,'验证码无效或已过期')`）

- [ ] **Step 1: 加依赖**

在 `web/package.json` 的 `dependencies` 加 `"nodemailer": "^6.9.14"`，`devDependencies` 加 `"@types/nodemailer": "^6.4.15"`。

Run: `dc exec web npm install`
Expected: 安装成功（容器内 node_modules 更新）。

- [ ] **Step 2: session helper**

`web/lib/session.ts`:
```ts
import { NextResponse } from 'next/server'
import { signToken } from './jwt'

export async function setSessionCookie(
  res: NextResponse,
  session: { userId: string; role: string }
): Promise<NextResponse> {
  const token = await signToken(session)
  res.cookies.set('token', token, { httpOnly: true, sameSite: 'lax', path: '/', maxAge: 7 * 24 * 3600 })
  return res
}
```

- [ ] **Step 3: mailer**

`web/lib/mailer.ts`:
```ts
import nodemailer from 'nodemailer'
import { prisma } from '@mixcut/db'
import { decrypt } from './crypto'
import { HttpError } from './auth'

type Cfg = { host: string; port: number; secure: boolean; username: string; password: string; fromAddress: string; fromName: string }

async function loadCfg(): Promise<{ enabled: boolean; cfg: Cfg }> {
  const row = await prisma.smtpConfig.findUnique({ where: { id: 1 } })
  if (!row) return { enabled: false, cfg: { host: '', port: 465, secure: true, username: '', password: '', fromAddress: '', fromName: '投流工作台' } }
  return {
    enabled: !!(row.enabled && row.host),
    cfg: { host: row.host, port: row.port, secure: row.secure, username: row.username, password: decrypt(row.passwordEnc), fromAddress: row.fromAddress, fromName: row.fromName },
  }
}

export async function emailEnabled(): Promise<boolean> {
  return (await loadCfg()).enabled
}

function transport(cfg: Cfg) {
  return nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    auth: cfg.username ? { user: cfg.username, pass: cfg.password } : undefined,
  })
}

export async function sendMail(to: string, subject: string, html: string): Promise<void> {
  const { enabled, cfg } = await loadCfg()
  if (!enabled) throw new HttpError(400, '未开启邮件服务')
  await transport(cfg).sendMail({ from: `"${cfg.fromName}" <${cfg.fromAddress}>`, to, subject, html })
}

export async function sendTestMail(
  cfg: Cfg,
  to: string
): Promise<void> {
  await transport(cfg).sendMail({
    from: `"${cfg.fromName}" <${cfg.fromAddress}>`,
    to,
    subject: '投流工作台 · SMTP 测试邮件',
    html: '<p>这是一封测试邮件，收到即表示 SMTP 配置可用。</p>',
  })
}
```

- [ ] **Step 4: emailflow（发码/验码）**

`web/lib/emailflow.ts`:
```ts
import { prisma } from '@mixcut/db'
import { genCode, hashCode } from './authcodes'
import { sendMail } from './mailer'
import { HttpError } from './auth'

const TTL_MS = 10 * 60 * 1000

export async function sendCode(email: string, purpose: 'verify' | 'reset'): Promise<void> {
  // 作废同邮箱同用途未消费旧码
  await prisma.emailCode.updateMany({
    where: { email, purpose, consumedAt: null },
    data: { consumedAt: new Date() },
  })
  const code = genCode()
  await prisma.emailCode.create({
    data: { email, purpose, codeHash: hashCode(code), expiresAt: new Date(Date.now() + TTL_MS) },
  })
  const title = purpose === 'verify' ? '注册验证码' : '重置密码验证码'
  await sendMail(email, `投流工作台 · ${title}`, `<p>你的${title}是 <b style="font-size:20px">${code}</b>，10 分钟内有效。</p>`)
}

export async function consumeCode(email: string, code: string, purpose: 'verify' | 'reset'): Promise<void> {
  const row = await prisma.emailCode.findFirst({
    where: { email, purpose, consumedAt: null, expiresAt: { gt: new Date() }, codeHash: hashCode(code) },
    orderBy: { createdAt: 'desc' },
  })
  if (!row) throw new HttpError(400, '验证码无效或已过期')
  await prisma.emailCode.update({ where: { id: row.id }, data: { consumedAt: new Date() } })
}
```

- [ ] **Step 5: 类型检查**

Run: `dc exec -e NODE_ENV=production web sh -c "cd /app/web && npx tsc --noEmit -p ."`
Expected: 无错误（现有单测不受影响，无需重跑）。

- [ ] **Step 6: Commit**

```bash
git add web/lib/session.ts web/lib/mailer.ts web/lib/emailflow.ts web/package.json web/package-lock.json
git commit -m "feat: 会话 cookie helper + nodemailer 发信与验证码存取"
```

---

### Task 4: SMTP 配置 API + /admin/settings 设置页

**Files:**
- Create: `web/app/api/admin/smtp/route.ts`、`web/app/api/admin/smtp/test/route.ts`
- Create: `web/app/admin/settings/page.tsx`

**Interfaces:**
- Consumes: `handler`、`requireRole`、`HttpError`、`prisma`、`encrypt`（Task 2）、`sendTestMail`（Task 3）、`api`（fetcher）
- Produces: HTTP `GET/PUT /api/admin/smtp`、`POST /api/admin/smtp/test`（均 operator）；页面 `/admin/settings`

- [ ] **Step 1: GET/PUT 配置路由**

`web/app/api/admin/smtp/route.ts`:
```ts
import { NextResponse } from 'next/server'
import { prisma } from '@mixcut/db'
import { requireRole, HttpError } from '@/lib/auth'
import { handler } from '@/lib/api'
import { encrypt } from '@/lib/crypto'

export const GET = handler(async () => {
  await requireRole('operator')
  const row = await prisma.smtpConfig.findUnique({ where: { id: 1 } })
  return NextResponse.json({
    host: row?.host ?? '', port: row?.port ?? 465, secure: row?.secure ?? true,
    username: row?.username ?? '', fromAddress: row?.fromAddress ?? '', fromName: row?.fromName ?? '投流工作台',
    enabled: row?.enabled ?? false, hasPassword: !!row?.passwordEnc,
  })
})

export const PUT = handler(async (req) => {
  await requireRole('operator')
  const b = await req.json()
  if (b.enabled && !b.host?.trim()) throw new HttpError(400, '开启前请先填写 SMTP 主机')
  const data: Record<string, unknown> = {
    host: String(b.host ?? '').trim(), port: Number(b.port ?? 465), secure: !!b.secure,
    username: String(b.username ?? '').trim(), fromAddress: String(b.fromAddress ?? '').trim(),
    fromName: String(b.fromName ?? '投流工作台').trim(), enabled: !!b.enabled,
  }
  if (typeof b.password === 'string' && b.password.length > 0) data.passwordEnc = encrypt(b.password)
  const row = await prisma.smtpConfig.upsert({
    where: { id: 1 },
    update: data,
    create: { id: 1, ...data, passwordEnc: typeof b.password === 'string' && b.password ? encrypt(b.password) : '' },
  })
  return NextResponse.json({ ok: true, hasPassword: !!row.passwordEnc })
})
```

- [ ] **Step 2: 测试发信路由**

`web/app/api/admin/smtp/test/route.ts`:
```ts
import { NextResponse } from 'next/server'
import { prisma } from '@mixcut/db'
import { requireRole, HttpError } from '@/lib/auth'
import { handler } from '@/lib/api'
import { decrypt } from '@/lib/crypto'
import { sendTestMail } from '@/lib/mailer'

export const POST = handler(async (req) => {
  await requireRole('operator')
  const b = await req.json()
  if (!b.to?.trim()) throw new HttpError(400, '请填写测试收件邮箱')
  const row = await prisma.smtpConfig.findUnique({ where: { id: 1 } })
  // 表单里若填了新密码用新密码，否则用库里已存的
  const password = typeof b.password === 'string' && b.password ? b.password : decrypt(row?.passwordEnc ?? '')
  const cfg = {
    host: String(b.host ?? row?.host ?? '').trim(), port: Number(b.port ?? row?.port ?? 465),
    secure: b.secure ?? row?.secure ?? true, username: String(b.username ?? row?.username ?? '').trim(),
    password, fromAddress: String(b.fromAddress ?? row?.fromAddress ?? '').trim(),
    fromName: String(b.fromName ?? row?.fromName ?? '投流工作台').trim(),
  }
  if (!cfg.host) throw new HttpError(400, '请先填写 SMTP 主机')
  try {
    await sendTestMail(cfg, String(b.to).trim())
  } catch (e) {
    throw new HttpError(400, '发送失败：' + (e as Error).message)
  }
  return NextResponse.json({ ok: true })
})
```

- [ ] **Step 3: 设置页**

`web/app/admin/settings/page.tsx`:
```tsx
'use client'
import { useEffect, useState } from 'react'
import { api } from '@/lib/fetcher'

type Cfg = { host: string; port: number; secure: boolean; username: string; fromAddress: string; fromName: string; enabled: boolean; hasPassword: boolean }

export default function SettingsPage() {
  const [cfg, setCfg] = useState<Cfg | null>(null)
  const [password, setPassword] = useState('')
  const [testTo, setTestTo] = useState('')
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => { api<Cfg>('/api/admin/smtp').then(setCfg).catch((e) => setErr((e as Error).message)) }, [])

  function up<K extends keyof Cfg>(k: K, v: Cfg[K]) { setCfg((c) => (c ? { ...c, [k]: v } : c)) }

  async function save() {
    if (!cfg) return
    setBusy(true); setErr(''); setMsg('')
    try {
      await api('/api/admin/smtp', { method: 'PUT', body: { ...cfg, password: password || undefined } })
      setMsg('已保存'); setPassword('')
      setCfg(await api<Cfg>('/api/admin/smtp'))
    } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }
  async function test() {
    if (!cfg) return
    setBusy(true); setErr(''); setMsg('')
    try {
      await api('/api/admin/smtp/test', { method: 'POST', body: { ...cfg, password: password || undefined, to: testTo } })
      setMsg('测试邮件已发送')
    } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }

  if (!cfg && err) return <p className="pill pill-bad">{err}</p>
  if (!cfg) return <p className="text-ink3">加载中…</p>

  return (
    <div className="max-w-xl space-y-6">
      <h1 className="font-display text-2xl font-bold">邮件服务（SMTP）</h1>
      {err && <p className="pill pill-bad">{err}</p>}
      {msg && <p className="pill pill-ok">{msg}</p>}

      <div className="card space-y-4 p-5">
        <label className="flex items-center justify-between">
          <span className="font-medium">启用邮件服务</span>
          <input type="checkbox" checked={cfg.enabled} onChange={(e) => up('enabled', e.target.checked)} className="h-5 w-5" />
        </label>
        <p className="text-xs text-ink3">关闭时：注册直接可用、忘记密码不可用。开启时：注册需邮箱验证码、支持忘记密码。</p>
      </div>

      <div className="card grid gap-3 p-5">
        <label className="text-sm text-ink2">SMTP 主机
          <input className="field mt-1" value={cfg.host} onChange={(e) => up('host', e.target.value)} placeholder="smtp.example.com" /></label>
        <div className="flex gap-3">
          <label className="flex-1 text-sm text-ink2">端口
            <input className="field mt-1" type="number" value={cfg.port} onChange={(e) => up('port', Number(e.target.value))} /></label>
          <label className="flex-1 text-sm text-ink2">加密
            <select className="field mt-1" value={cfg.secure ? 'ssl' : 'starttls'} onChange={(e) => up('secure', e.target.value === 'ssl')}>
              <option value="ssl">SSL (465)</option>
              <option value="starttls">STARTTLS (587)</option>
            </select></label>
        </div>
        <label className="text-sm text-ink2">账号
          <input className="field mt-1" value={cfg.username} onChange={(e) => up('username', e.target.value)} autoCapitalize="none" /></label>
        <label className="text-sm text-ink2">密码 {cfg.hasPassword && <span className="text-ink3">（已设置，留空则不改）</span>}
          <input className="field mt-1" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder={cfg.hasPassword ? '••••••••' : ''} /></label>
        <div className="flex gap-3">
          <label className="flex-1 text-sm text-ink2">发件邮箱
            <input className="field mt-1" value={cfg.fromAddress} onChange={(e) => up('fromAddress', e.target.value)} autoCapitalize="none" /></label>
          <label className="flex-1 text-sm text-ink2">发件人名
            <input className="field mt-1" value={cfg.fromName} onChange={(e) => up('fromName', e.target.value)} /></label>
        </div>
        <button onClick={save} disabled={busy} className="btn-primary">保存配置</button>
      </div>

      <div className="card space-y-3 p-5">
        <p className="eyebrow">发送测试邮件</p>
        <div className="flex gap-3">
          <input className="field" value={testTo} onChange={(e) => setTestTo(e.target.value)} placeholder="收件邮箱" autoCapitalize="none" />
          <button onClick={test} disabled={busy || !testTo} className="btn-ghost shrink-0">发送</button>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: curl 验证（operator 登录后）**

先起容器并确保有 operator（Task 10 才 seed，此处临时插一个）：
```bash
dc exec web node -e "const b=require('bcryptjs');const{PrismaClient}=require('@prisma/client');const p=new PrismaClient();p.user.upsert({where:{email:'op@t.com'},update:{},create:{email:'op@t.com',nickname:'op',passwordHash:b.hashSync('op123456',10),role:'operator'}}).then(()=>console.log('ok')).finally(()=>p.\$disconnect())"
curl -s -c /tmp/op.txt -X POST http://localhost:3000/api/auth/login -H 'Content-Type: application/json' -d '{"email":"op@t.com","password":"op123456"}'
curl -s -b /tmp/op.txt http://localhost:3000/api/admin/smtp
curl -s -b /tmp/op.txt -X PUT http://localhost:3000/api/admin/smtp -H 'Content-Type: application/json' -d '{"host":"smtp.x.com","port":587,"secure":false,"username":"u","password":"secret","fromAddress":"n@x.com","fromName":"投流","enabled":true}'
curl -s -b /tmp/op.txt http://localhost:3000/api/admin/smtp
```
Expected：login 返回 `{"role":"operator"}`；首个 GET 返回默认配置 `hasPassword:false`；PUT 后 GET 返回 `enabled:true`、`hasPassword:true`、**不含明文密码**。
> 该验证依赖 Task 5 的 login 已改为按邮箱。若 Task 4 先做，可用现账号密钥临时登录，或先做 Task 5。建议执行顺序 1→2→3→**5→4** 亦可；本计划按依赖关系 4 依赖 5 的 login 改造做集成验证，实施时若顺序不便可只验证到 PUT 成功、GET 脱敏两点（用 Task 5 完成后回归）。

- [ ] **Step 5: Commit**

```bash
git add web/app/api/admin/smtp web/app/admin/settings
git commit -m "feat: SMTP 配置 API（脱敏/加密）与设置页（含测试发信）"
```

---

### Task 5: 认证 API —— config/register/verify-email/login/forgot/reset

**Files:**
- Create: `web/app/api/auth/config/route.ts`、`web/app/api/auth/verify-email/route.ts`、`web/app/api/auth/forgot/route.ts`、`web/app/api/auth/reset/route.ts`
- Modify: `web/app/api/auth/login/route.ts`、`web/app/api/auth/register/route.ts`

**Interfaces:**
- Consumes: `handler`、`HttpError`、`prisma`、`bcrypt`、`isEmail`、`emailEnabled`、`sendCode`、`consumeCode`、`setSessionCookie`
- Produces: HTTP `GET /api/auth/config`、`POST /api/auth/{register,verify-email,login,forgot,reset}`

- [ ] **Step 1: config**

`web/app/api/auth/config/route.ts`:
```ts
import { NextResponse } from 'next/server'
import { handler } from '@/lib/api'
import { emailEnabled } from '@/lib/mailer'

export const GET = handler(async () => {
  return NextResponse.json({ emailEnabled: await emailEnabled() })
})
```

- [ ] **Step 2: register（改：公开、学员、按 SMTP 分支）**

`web/app/api/auth/register/route.ts`（整体替换）:
```ts
import { NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { prisma } from '@mixcut/db'
import { HttpError } from '@/lib/auth'
import { handler } from '@/lib/api'
import { isEmail } from '@/lib/authcodes'
import { emailEnabled } from '@/lib/mailer'
import { sendCode } from '@/lib/emailflow'
import { setSessionCookie } from '@/lib/session'

export const POST = handler(async (req) => {
  const { email, password, nickname } = await req.json()
  if (!isEmail(email)) throw new HttpError(400, '邮箱格式不正确')
  if (!password || password.length < 6) throw new HttpError(400, '密码至少 6 位')
  if (!nickname?.trim()) throw new HttpError(400, '请填写昵称')
  if (await prisma.user.findUnique({ where: { email } })) throw new HttpError(409, '该邮箱已注册')

  if (await emailEnabled()) {
    await sendCode(email, 'verify')
    return NextResponse.json({ needsVerification: true })
  }
  const user = await prisma.user.create({
    data: { email, nickname: nickname.trim(), account: email, passwordHash: await bcrypt.hash(password, 10), role: 'student' },
  })
  return setSessionCookie(NextResponse.json({ role: user.role, needsVerification: false }), { userId: user.id, role: user.role })
})
```

- [ ] **Step 3: verify-email**

`web/app/api/auth/verify-email/route.ts`:
```ts
import { NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { prisma } from '@mixcut/db'
import { HttpError } from '@/lib/auth'
import { handler } from '@/lib/api'
import { isEmail } from '@/lib/authcodes'
import { consumeCode } from '@/lib/emailflow'
import { setSessionCookie } from '@/lib/session'

export const POST = handler(async (req) => {
  const { email, code, password, nickname } = await req.json()
  if (!isEmail(email) || !password || password.length < 6 || !nickname?.trim()) throw new HttpError(400, '参数不完整')
  await consumeCode(email, String(code ?? ''), 'verify')
  if (await prisma.user.findUnique({ where: { email } })) throw new HttpError(409, '该邮箱已注册')
  const user = await prisma.user.create({
    data: { email, nickname: nickname.trim(), account: email, passwordHash: await bcrypt.hash(password, 10), role: 'student' },
  })
  return setSessionCookie(NextResponse.json({ role: user.role }), { userId: user.id, role: user.role })
})
```

- [ ] **Step 4: login（改：按邮箱，去掉密钥分支）**

`web/app/api/auth/login/route.ts`（整体替换）:
```ts
import { NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { prisma } from '@mixcut/db'
import { HttpError } from '@/lib/auth'
import { handler } from '@/lib/api'
import { setSessionCookie } from '@/lib/session'

export const POST = handler(async (req) => {
  const { email, password } = await req.json()
  if (!email || !password) throw new HttpError(400, '请填写邮箱和密码')
  const user = await prisma.user.findUnique({ where: { email } })
  if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
    throw new HttpError(401, '邮箱或密码错误')
  }
  return setSessionCookie(NextResponse.json({ role: user.role }), { userId: user.id, role: user.role })
})
```

- [ ] **Step 5: forgot + reset**

`web/app/api/auth/forgot/route.ts`:
```ts
import { NextResponse } from 'next/server'
import { prisma } from '@mixcut/db'
import { HttpError } from '@/lib/auth'
import { handler } from '@/lib/api'
import { isEmail } from '@/lib/authcodes'
import { emailEnabled } from '@/lib/mailer'
import { sendCode } from '@/lib/emailflow'

export const POST = handler(async (req) => {
  const { email } = await req.json()
  if (!isEmail(email)) throw new HttpError(400, '邮箱格式不正确')
  if (!(await emailEnabled())) throw new HttpError(400, '未开启邮件服务')
  if (await prisma.user.findUnique({ where: { email } })) await sendCode(email, 'reset')
  return NextResponse.json({ ok: true }) // 无论是否存在都 200，防枚举
})
```

`web/app/api/auth/reset/route.ts`:
```ts
import { NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { prisma } from '@mixcut/db'
import { HttpError } from '@/lib/auth'
import { handler } from '@/lib/api'
import { consumeCode } from '@/lib/emailflow'

export const POST = handler(async (req) => {
  const { email, code, newPassword } = await req.json()
  if (!newPassword || newPassword.length < 6) throw new HttpError(400, '新密码至少 6 位')
  await consumeCode(email, String(code ?? ''), 'reset')
  const user = await prisma.user.findUnique({ where: { email } })
  if (!user) throw new HttpError(400, '账号不存在')
  await prisma.user.update({ where: { id: user.id }, data: { passwordHash: await bcrypt.hash(newPassword, 10) } })
  return NextResponse.json({ ok: true })
})
```

- [ ] **Step 6: curl 验证（SMTP 关路径）**

确保 `smtp_config.enabled=false`（默认）。
```bash
curl -s -c /tmp/s.txt -X POST http://localhost:3000/api/auth/register -H 'Content-Type: application/json' -d '{"email":"stu@t.com","password":"stu123","nickname":"小学员"}'
curl -s http://localhost:3000/api/auth/config
curl -s -X POST http://localhost:3000/api/auth/login -H 'Content-Type: application/json' -d '{"email":"stu@t.com","password":"wrong"}'
curl -s -X POST http://localhost:3000/api/auth/forgot -H 'Content-Type: application/json' -d '{"email":"stu@t.com"}'
```
Expected：register 返回 `{"role":"student","needsVerification":false}` 并种下 cookie；config 返回 `{"emailEnabled":false}`；错误密码 `{"error":"邮箱或密码错误"}`；forgot 在 SMTP 关时 `{"error":"未开启邮件服务"}`。SMTP 开路径（发码/verify/reset）在 Task 10 用真实/捕获 SMTP 集成验证。

- [ ] **Step 7: Commit**

```bash
git add web/app/api/auth
git commit -m "feat: 邮箱注册/验证/登录/忘密/重置 认证接口"
```

---

### Task 6: 移动端登录/注册页改造

**Files:**
- Modify: `web/app/(auth)/login/page.tsx`（整体替换）

**Interfaces:**
- Consumes: `api`（fetcher）、`GET /api/auth/config`、`/api/auth/{login,register,verify-email,forgot,reset}`

- [ ] **Step 1: 整体替换登录页**

`web/app/(auth)/login/page.tsx`:
```tsx
'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { api } from '@/lib/fetcher'

type Tab = 'login' | 'register'

export default function LoginPage() {
  const router = useRouter()
  const [emailEnabled, setEmailEnabled] = useState(false)
  const [tab, setTab] = useState<Tab>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [nickname, setNickname] = useState('')
  const [code, setCode] = useState('')
  const [stage, setStage] = useState<'form' | 'verify' | 'forgot' | 'reset'>('form')
  const [err, setErr] = useState('')
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => { api<{ emailEnabled: boolean }>('/api/auth/config').then((c) => setEmailEnabled(c.emailEnabled)).catch(() => {}) }, [])

  function reset() { setErr(''); setMsg('') }
  function go(role: string) { router.replace(role === 'operator' ? '/admin/students' : '/') }

  async function login() {
    reset(); setBusy(true)
    try { const r = await api<{ role: string }>('/api/auth/login', { body: { email, password } }); go(r.role) }
    catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }
  async function register() {
    reset(); setBusy(true)
    try {
      const r = await api<{ role?: string; needsVerification: boolean }>('/api/auth/register', { body: { email, password, nickname } })
      if (r.needsVerification) { setStage('verify'); setMsg('验证码已发送至邮箱') } else go(r.role!)
    } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }
  async function verify() {
    reset(); setBusy(true)
    try { const r = await api<{ role: string }>('/api/auth/verify-email', { body: { email, password, nickname, code } }); go(r.role) }
    catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }
  async function forgot() {
    reset(); setBusy(true)
    try { await api('/api/auth/forgot', { body: { email } }); setStage('reset'); setMsg('若邮箱已注册，验证码已发送') }
    catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }
  async function doReset() {
    reset(); setBusy(true)
    try { await api('/api/auth/reset', { body: { email, code, newPassword: password } }); setMsg('密码已重置，请登录'); setStage('form'); setTab('login'); setPassword(''); setCode('') }
    catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }

  return (
    <div className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-6 px-6">
      <div className="space-y-3">
        <span className="grad inline-flex h-11 w-11 items-center justify-center rounded-2xl text-xl shadow-lift">⚡</span>
        <h1 className="font-display text-[2rem] font-bold leading-none tracking-tight">投流<span className="grad-text">工作台</span></h1>
        <p className="text-sm text-ink2">一键把素材混成投流爆款。</p>
      </div>

      {stage === 'form' && (
        <>
          <div className="flex gap-1 rounded-2xl bg-surface2 p-1 text-sm">
            {(['login', 'register'] as Tab[]).map((t) => (
              <button key={t} onClick={() => { setTab(t); reset() }}
                className={`flex-1 rounded-xl py-2.5 font-medium transition ${tab === t ? 'bg-surface text-ink shadow-card' : 'text-ink3'}`}>
                {t === 'login' ? '登录' : '注册'}
              </button>
            ))}
          </div>
          <div className="space-y-3">
            <input className="field" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="邮箱" autoCapitalize="none" />
            {tab === 'register' && <input className="field" value={nickname} onChange={(e) => setNickname(e.target.value)} placeholder="昵称" />}
            <input className="field" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="密码" />
            {err && <p className="pill pill-bad">{err}</p>}
            {msg && <p className="pill pill-ok">{msg}</p>}
            <button onClick={tab === 'login' ? login : register} disabled={busy} className="btn-primary w-full">
              {busy ? '处理中…' : tab === 'login' ? '进入工作台' : '注册'}
            </button>
            {tab === 'login' && emailEnabled && (
              <button onClick={() => { setStage('forgot'); reset() }} className="w-full text-center text-sm text-ink3">忘记密码？</button>
            )}
          </div>
        </>
      )}

      {stage === 'verify' && (
        <div className="space-y-3">
          <p className="text-sm text-ink2">验证码已发送至 <b>{email}</b></p>
          <input className="field num tracking-widest" value={code} onChange={(e) => setCode(e.target.value)} placeholder="6 位验证码" inputMode="numeric" />
          {err && <p className="pill pill-bad">{err}</p>}
          {msg && <p className="pill pill-ok">{msg}</p>}
          <button onClick={verify} disabled={busy} className="btn-primary w-full">完成注册</button>
          <button onClick={() => { setStage('form'); reset() }} className="w-full text-center text-sm text-ink3">返回</button>
        </div>
      )}

      {stage === 'forgot' && (
        <div className="space-y-3">
          <input className="field" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="注册邮箱" autoCapitalize="none" />
          {err && <p className="pill pill-bad">{err}</p>}
          <button onClick={forgot} disabled={busy} className="btn-primary w-full">发送重置验证码</button>
          <button onClick={() => { setStage('form'); reset() }} className="w-full text-center text-sm text-ink3">返回登录</button>
        </div>
      )}

      {stage === 'reset' && (
        <div className="space-y-3">
          <input className="field num tracking-widest" value={code} onChange={(e) => setCode(e.target.value)} placeholder="6 位验证码" inputMode="numeric" />
          <input className="field" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="新密码" />
          {err && <p className="pill pill-bad">{err}</p>}
          {msg && <p className="pill pill-ok">{msg}</p>}
          <button onClick={doReset} disabled={busy} className="btn-primary w-full">重置密码</button>
          <button onClick={() => { setStage('form'); reset() }} className="w-full text-center text-sm text-ink3">返回登录</button>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: 手动验证**

Run: `curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3000/login`
Expected：200；浏览器（375px）能看到「登录 / 注册」tab，注册含昵称，SMTP 开时登录页出现「忘记密码？」。

- [ ] **Step 3: Commit**

```bash
git add "web/app/(auth)/login/page.tsx"
git commit -m "feat: 移动端登录页改造（登录/注册/验证码/忘密，去密钥登录）"
```

---

### Task 7: PC 桌面控制台外壳（侧边栏布局）

**Files:**
- Create: `web/components/SidebarNav.tsx`
- Modify: `web/app/admin/layout.tsx`（整体替换）

**Interfaces:**
- Produces: 桌面外壳（左侧固定侧边栏 + 顶栏 + 宽内容区）；导航项 学员数据/标签/素材/文案/任务/设置

- [ ] **Step 1: SidebarNav（客户端，active 高亮）**

`web/components/SidebarNav.tsx`:
```tsx
'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

const NAV = [
  { href: '/admin/students', label: '学员数据' },
  { href: '/admin/tags', label: '标签' },
  { href: '/admin/materials', label: '素材' },
  { href: '/admin/scripts', label: '文案' },
  { href: '/admin/tasks', label: '任务' },
  { href: '/admin/settings', label: '设置' },
]

export default function SidebarNav() {
  const path = usePathname()
  return (
    <nav className="flex flex-col gap-1">
      {NAV.map((n) => {
        const active = path.startsWith(n.href)
        return (
          <Link key={n.href} href={n.href}
            className={`rounded-xl px-4 py-2.5 text-sm font-medium transition ${active ? 'grad text-white shadow-lift' : 'text-ink2 hover:bg-surface2'}`}>
            {n.label}
          </Link>
        )
      })}
    </nav>
  )
}
```

- [ ] **Step 2: 桌面 layout**

`web/app/admin/layout.tsx`（整体替换）:
```tsx
import SidebarNav from '@/components/SidebarNav'
import SignOut from '@/components/SignOut'

export const dynamic = 'force-dynamic'

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh">
      <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col justify-between border-r border-line bg-surface p-4 md:flex">
        <div className="space-y-6">
          <div className="flex items-center gap-2 px-2">
            <span className="grad h-6 w-6 rounded-md shadow-lift" />
            <span className="font-display text-base font-bold">运营控制台</span>
          </div>
          <SidebarNav />
        </div>
        <div className="flex items-center justify-between px-2">
          <span className="chip"><span className="chip-dot bg-warn" />运营</span>
          <SignOut />
        </div>
      </aside>
      <main className="min-w-0 flex-1 px-5 py-6 md:px-10">
        <div className="mx-auto max-w-6xl">{children}</div>
      </main>
    </div>
  )
}
```
> 窄屏（<md）侧边栏隐藏；本期以 PC 为主，窄屏仍可通过直接 URL 访问各页。若需窄屏导航可后续加顶部抽屉。

- [ ] **Step 3: 验证**

Run: `curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3000/admin/tags`（需 operator cookie，否则 307）
Expected：operator 访问 200；桌面宽度可见左侧边栏，当前项火焰高亮。

- [ ] **Step 4: Commit**

```bash
git add web/components/SidebarNav.tsx web/app/admin/layout.tsx
git commit -m "feat: PC 控制台桌面外壳（左侧边栏导航）"
```

---

### Task 8: 学员数据 API + 页面（统计看板 + 数据表）

**Files:**
- Create: `web/app/api/admin/students/route.ts`、`web/app/admin/students/page.tsx`

**Interfaces:**
- Consumes: `handler`、`requireRole`、`prisma`
- Produces: `GET /api/admin/students?search=&page=&pageSize=` → `{ stats: { totalStudents, todayNew, totalTasks, totalExported }, students: { id, email, nickname, createdAt, taskCount, doneCount }[], total }`

- [ ] **Step 1: API**

`web/app/api/admin/students/route.ts`:
```ts
import { NextResponse } from 'next/server'
import { prisma } from '@mixcut/db'
import { requireRole } from '@/lib/auth'
import { handler } from '@/lib/api'

export const GET = handler(async (req) => {
  await requireRole('operator')
  const url = new URL(req.url)
  const search = (url.searchParams.get('search') ?? '').trim()
  const page = Math.max(1, Number(url.searchParams.get('page') ?? 1))
  const pageSize = Math.min(50, Math.max(1, Number(url.searchParams.get('pageSize') ?? 20)))

  const where = {
    role: 'student',
    ...(search ? { OR: [{ email: { contains: search, mode: 'insensitive' as const } }, { nickname: { contains: search, mode: 'insensitive' as const } }] } : {}),
  }

  const startOfToday = new Date(); startOfToday.setHours(0, 0, 0, 0)
  const [total, totalStudents, todayNew, totalTasks, totalExported, rows] = await Promise.all([
    prisma.user.count({ where }),
    prisma.user.count({ where: { role: 'student' } }),
    prisma.user.count({ where: { role: 'student', createdAt: { gte: startOfToday } } }),
    prisma.task.count(),
    prisma.task.count({ where: { status: 'EXPORTED' } }),
    prisma.user.findMany({
      where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * pageSize, take: pageSize,
      select: { id: true, email: true, nickname: true, createdAt: true, tasks: { select: { status: true } } },
    }),
  ])

  const students = rows.map((u) => ({
    id: u.id, email: u.email, nickname: u.nickname, createdAt: u.createdAt,
    taskCount: u.tasks.length, doneCount: u.tasks.filter((t) => t.status === 'EXPORTED').length,
  }))
  return NextResponse.json({ stats: { totalStudents, todayNew, totalTasks, totalExported }, students, total })
})
```

- [ ] **Step 2: 页面**

`web/app/admin/students/page.tsx`:
```tsx
'use client'
import { useCallback, useEffect, useState } from 'react'
import { api } from '@/lib/fetcher'

type Row = { id: string; email: string; nickname: string | null; createdAt: string; taskCount: number; doneCount: number }
type Resp = { stats: { totalStudents: number; todayNew: number; totalTasks: number; totalExported: number }; students: Row[]; total: number }

const PAGE = 20

export default function StudentsPage() {
  const [data, setData] = useState<Resp | null>(null)
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [err, setErr] = useState('')

  const load = useCallback(async () => {
    try { setData(await api<Resp>(`/api/admin/students?search=${encodeURIComponent(search)}&page=${page}&pageSize=${PAGE}`)) }
    catch (e) { setErr((e as Error).message) }
  }, [search, page])
  useEffect(() => { load() }, [load])

  const stats = data?.stats
  const cards = [
    { k: '总学员数', v: stats?.totalStudents }, { k: '今日新增', v: stats?.todayNew },
    { k: '总任务数', v: stats?.totalTasks }, { k: '导出成片', v: stats?.totalExported },
  ]
  const pages = data ? Math.max(1, Math.ceil(data.total / PAGE)) : 1

  return (
    <div className="space-y-6">
      <h1 className="font-display text-2xl font-bold">注册学员数据</h1>
      {err && <p className="pill pill-bad">{err}</p>}

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        {cards.map((c) => (
          <div key={c.k} className="card p-5">
            <p className="text-sm text-ink3">{c.k}</p>
            <p className="num mt-1 text-3xl font-bold">{c.v ?? '—'}</p>
          </div>
        ))}
      </div>

      <div className="flex items-center gap-3">
        <input className="field max-w-xs" value={search} onChange={(e) => { setPage(1); setSearch(e.target.value) }} placeholder="搜索邮箱 / 昵称" autoCapitalize="none" />
      </div>

      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-surface2 text-left text-ink3">
            <tr>
              <th className="px-4 py-3 font-medium">邮箱</th>
              <th className="px-4 py-3 font-medium">昵称</th>
              <th className="px-4 py-3 font-medium">注册时间</th>
              <th className="px-4 py-3 text-right font-medium">任务数</th>
              <th className="px-4 py-3 text-right font-medium">已完成</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {data?.students.map((s) => (
              <tr key={s.id}>
                <td className="px-4 py-3">{s.email}</td>
                <td className="px-4 py-3">{s.nickname ?? '—'}</td>
                <td className="num px-4 py-3 text-ink2">{new Date(s.createdAt).toLocaleString('zh-CN')}</td>
                <td className="num px-4 py-3 text-right">{s.taskCount}</td>
                <td className="num px-4 py-3 text-right text-ok">{s.doneCount}</td>
              </tr>
            ))}
            {data && data.students.length === 0 && (
              <tr><td colSpan={5} className="px-4 py-10 text-center text-ink3">暂无学员</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {pages > 1 && (
        <div className="flex items-center justify-center gap-3">
          <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1} className="btn-ghost px-4">上一页</button>
          <span className="num text-sm text-ink2">{page} / {pages}</span>
          <button onClick={() => setPage((p) => Math.min(pages, p + 1))} disabled={page >= pages} className="btn-ghost px-4">下一页</button>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 3: curl 验证**

```bash
curl -s -b /tmp/op.txt 'http://localhost:3000/api/admin/students?page=1&pageSize=20'
```
Expected：返回 `{stats:{...}, students:[...], total:N}`；`stats.totalStudents` 与库中 student 数一致；分页/搜索生效。

- [ ] **Step 4: Commit**

```bash
git add web/app/api/admin/students web/app/admin/students
git commit -m "feat: 学员数据 API 与页面（统计看板 + 分页数据表）"
```

---

### Task 9: 现有四个运营页改桌面版

**Files:**
- Modify: `web/app/admin/tags/page.tsx`、`web/app/admin/materials/page.tsx`、`web/app/admin/scripts/page.tsx`、`web/app/admin/scripts/[id]/page.tsx`、`web/app/admin/tasks/page.tsx`、`web/app/admin/tasks/[id]/page.tsx`

**Interfaces:**
- 仅表现层：逻辑/hooks/接口/props 全部保留，仅调整容器宽度与列表→表格/多列呈现。

> 本任务是纯表现层桌面适配。规则统一如下，逐文件套用；**不得改动任何 hooks/state/handler/接口/条件/props**。

**桌面适配规则：**
1. 根容器去掉移动窄栏假设：列表页标题 `<h1 className="font-display text-2xl font-bold">…</h1>` 保持；页面根用 `space-y-6`。
2. **列表类**（tags 行、tasks 列表、scripts 列表、materials 缩略图）在桌面用更宽排布：
   - tasks 列表：由移动卡片改为**表格**（列：文案标题 / 状态(用 `<StatusPill>`) / 创建时间 / 操作「查看」链接），外层 `.card overflow-hidden`，表头 `bg-surface2`，行 `divide-y divide-line`。参照 Task 8 的 table 结构。
   - scripts 列表：同改为表格（列：标题 / 段数(`.num`) / 状态(草稿 `chip` / 已发布 `pill pill-ok`) / 操作）。
   - materials 缩略图网格：桌面加多列 `grid-cols-2 md:grid-cols-4 lg:grid-cols-5`（移动仍 2 列）。
   - tags 树：保持 `.card divide-y divide-line` 列表，桌面下加大左右 padding `md:px-6`，行内操作按钮右对齐。
3. **详情类**（scripts/[id]、tasks/[id]）：把单列窄内容放进 `max-w-3xl`（外层 admin layout 已给 `max-w-6xl` 居中，可再包一层约束阅读宽度）；分镜编辑器 tasks/[id] 的分镜卡片在桌面用 `grid gap-4 md:grid-cols-2` 两列排布；底部抽屉 BottomSheet 桌面下限制 `max-w-lg mx-auto` 居中。
4. 触点：桌面按钮沿用 `.btn-*`（已 ≥48px）；表格操作用 `.btn-quiet`/文字链接。
5. 保留所有中文文案与既有交互（发布切换、上下移、换素材、上传进度、returnTaskId 回流、轮询、重置并重试）。

- [ ] **Step 1: 逐页套用上述规则（tags → materials → scripts → scripts/[id] → tasks → tasks/[id]）**

对每个文件：只改 JSX 容器/className/列表呈现结构，逐一对照「桌面适配规则」。改完每个文件后本地打开对应 `/admin/*` 页在桌面宽度目测：无横向滚动、表格/多列生效、交互不变。

- [ ] **Step 2: 类型检查 + 目测**

Run: `dc exec -e NODE_ENV=production web sh -c "cd /app/web && npx tsc --noEmit -p ."`
Expected：无错误。浏览器桌面宽度逐页确认呈现与交互。

- [ ] **Step 3: Commit**

```bash
git add web/app/admin
git commit -m "feat: 运营四页桌面版适配（表格/多列/宽内容，逻辑不变）"
```

---

### Task 10: 种子更新 + 全链路验收（含生产构建）

**Files:**
- Modify: `worker/src/seed.ts`

**Interfaces:**
- Consumes: 前面全部任务。

- [ ] **Step 1: 更新 seed**

改 `worker/src/seed.ts` 的账号部分（其余标签树/素材/文案逻辑保留）：
- 运营：`email='operator@demo.com'`、`nickname='运营小队'`、`passwordHash=bcrypt('op123456')`、`role='operator'`、`account='operator@demo.com'`。
- 学员示例（3 个）：`email='student1@demo.com'..'student3@demo.com'`、`nickname='学员一/二/三'`、`passwordHash=bcrypt('stu123456')`、`role='student'`、`account=同 email`。用 `upsert({ where: { email }, ... })`。
- 去掉 access key 相关种子。
- 保证 `SmtpConfig` 存在单行（`prisma.smtpConfig.upsert({ where:{id:1}, update:{}, create:{ id:1 } })`，默认 `enabled=false`）。

具体账号写法（替换原 user upsert 段）:
```ts
await prisma.user.upsert({
  where: { email: 'operator@demo.com' },
  update: {},
  create: { email: 'operator@demo.com', account: 'operator@demo.com', nickname: '运营小队', passwordHash: bcrypt.hashSync('op123456', 10), role: 'operator' },
})
for (const [n, name] of [['student1', '学员一'], ['student2', '学员二'], ['student3', '学员三']] as const) {
  await prisma.user.upsert({
    where: { email: `${n}@demo.com` },
    update: {},
    create: { email: `${n}@demo.com`, account: `${n}@demo.com`, nickname: name, passwordHash: bcrypt.hashSync('stu123456', 10), role: 'student' },
  })
}
await prisma.smtpConfig.upsert({ where: { id: 1 }, update: {}, create: { id: 1 } })
```

- [ ] **Step 2: 迁移 + 跑种子（两次幂等）**

Run: `dc exec web npx prisma migrate deploy --schema packages/db/prisma/schema.prisma`
Run: `dc exec worker npm run seed && dc exec worker npm run seed`
Expected：两次均无报错、无重复。

- [ ] **Step 3: 全链路 curl 验收（SMTP 关）**

```bash
# 学员自助注册直接可用
curl -s -c /tmp/s.txt -X POST http://localhost:3000/api/auth/register -H 'Content-Type: application/json' -d '{"email":"new@demo.com","password":"pass123","nickname":"新学员"}'
# 运营登录 → 学员数据
curl -s -c /tmp/o.txt -X POST http://localhost:3000/api/auth/login -H 'Content-Type: application/json' -d '{"email":"operator@demo.com","password":"op123456"}'
curl -s -b /tmp/o.txt 'http://localhost:3000/api/admin/students' | head -c 300
# 忘密（SMTP 关）应 400
curl -s -X POST http://localhost:3000/api/auth/forgot -H 'Content-Type: application/json' -d '{"email":"new@demo.com"}'
```
Expected：注册 `{"role":"student","needsVerification":false}`；运营 `{"role":"operator"}`；学员数据含 stats 与至少 4 个学员（3 种子 + new）；忘密 `{"error":"未开启邮件服务"}`。

- [ ] **Step 4: SMTP 开路径验收（用捕获式 SMTP）**

用一次性 SMTP 捕获服务（如 Ethereal / Mailtrap）或本地 `MailHog`。若用 MailHog：`docker run -d -p 1025:1025 -p 8025:8025 mailhog/mailhog`，宿主机 `host.docker.internal:1025`。
在 `/admin/settings` 或 curl PUT 配置：`host=host.docker.internal, port=1025, secure=false, enabled=true`，发测试邮件确认 MailHog 收到。然后：
```bash
curl -s -X POST http://localhost:3000/api/auth/register -H 'Content-Type: application/json' -d '{"email":"verify@demo.com","password":"pass123","nickname":"待验证"}'
```
Expected：返回 `{"needsVerification":true}`；MailHog 收到验证码邮件；用该码调 `/api/auth/verify-email` 完成建号登录；`/api/auth/forgot` 现返回 `{"ok":true}` 并收到重置邮件。
> 验收后把 `enabled` 关回 false，保持 seed 默认态。

- [ ] **Step 5: 移动/桌面目测**

- 移动 375px：`/login` 登录/注册/验证码/忘密可用。
- 桌面：`operator` 登录落到 `/admin/students`，左侧边栏在 学员数据/标签/素材/文案/任务/设置 间切换，各页桌面呈现正常。

- [ ] **Step 6: 生产构建验证**

Run: `dc exec -e NODE_ENV=production web sh -c "cd /app/web && rm -rf .next && npx next build >/tmp/b.log 2>&1; echo EXIT=\$?; tail -6 /tmp/b.log"`
Expected：`EXIT=0`，无类型/预渲染错误。
> 必须带 `NODE_ENV=production`：dev 容器默认 `NODE_ENV=development` 会让 `next build` 拉入 dev runtime 导致预渲染报错（假失败）。

- [ ] **Step 7: 单测 + 最终提交**

Run: `npx vitest run`
Expected：全部通过（含 Task 2 新增）。
```bash
git add -A
git commit -m "chore: 种子更新（邮箱账号）与全链路验收"
```

---

## 计划自审记录

- **Spec 覆盖**：§3 数据模型→Task 1；§4 认证流程→Task 5（+Task 6 页面）；§4.1 config→Task 5；§5 登录页→Task 6；§6 SMTP 基础设施→Task 2(加密)/Task 3(mailer/codes)/Task 4(API+设置页)；§7 PC 控制台→Task 7(外壳)/Task 9(四页适配)；§7.3 学员数据→Task 8；§8 种子→Task 10；§10 测试→各任务单测 + Task 10 集成。
- **类型一致性**：`setSessionCookie(res, {userId,role})`、`sendCode(email,purpose)`/`consumeCode(email,code,purpose)`、`emailEnabled()`、`encrypt/decrypt`、`isEmail/genCode/hashCode`、`GET /api/admin/students` 返回结构在定义任务与消费任务间已核对一致。
- **执行顺序提示**：Task 4 的 curl 集成依赖 Task 5 的 login 邮箱改造；实施时若先做 4，其 GET/PUT 脱敏两点可独立验证，登录相关回归留到 5 完成后。其余任务按序即可。
- **占位符扫描**：无 TBD/TODO；Task 9 为纯表现层适配，给出统一规则 + 参照 Task 8 表格结构，不逐字重贴 6 个既有文件（属既有文件的样式改造，符合「改动既有大文件时按规则适配」）。
