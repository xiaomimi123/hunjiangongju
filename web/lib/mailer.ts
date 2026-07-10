import nodemailer from 'nodemailer'
import { prisma } from '@mixcut/db'
import { decrypt } from './crypto'
import { HttpError } from './auth'

type Cfg = { host: string; port: number; secure: boolean; username: string; password: string; fromAddress: string; fromName: string }

async function loadCfg(): Promise<{ enabled: boolean; cfg: Cfg }> {
  const row = await prisma.smtpConfig.findUnique({ where: { id: 1 } })
  if (!row) return { enabled: false, cfg: { host: '', port: 465, secure: true, username: '', password: '', fromAddress: '', fromName: '东方文澜' } }
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
    subject: '东方文澜 · SMTP 测试邮件',
    html: '<p>这是一封测试邮件，收到即表示 SMTP 配置可用。</p>',
  })
}
