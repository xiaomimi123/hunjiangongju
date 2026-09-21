// SMTP 发信（共享层）：web 的验证码/测试邮件与 worker 的每日告警日报共用。
// 原实现在 web/lib/mailer.ts，2026-09-21 因 worker 也要发信而下沉到这里。
import nodemailer from 'nodemailer'
import { prisma } from './client'
import { decrypt } from './crypto'

export type SmtpCfg = { host: string; port: number; secure: boolean; username: string; password: string; fromAddress: string; fromName: string }

export async function loadSmtpCfg(): Promise<{ enabled: boolean; cfg: SmtpCfg }> {
  const row = await prisma.smtpConfig.findUnique({ where: { id: 1 } })
  if (!row) return { enabled: false, cfg: { host: '', port: 465, secure: true, username: '', password: '', fromAddress: '', fromName: '东方文澜' } }
  return {
    enabled: !!(row.enabled && row.host),
    cfg: { host: row.host, port: row.port, secure: row.secure, username: row.username, password: decrypt(row.passwordEnc), fromAddress: row.fromAddress, fromName: row.fromName },
  }
}

export function smtpTransport(cfg: SmtpCfg) {
  return nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    auth: cfg.username ? { user: cfg.username, pass: cfg.password } : undefined,
  })
}

/** 发一封邮件。SMTP 未开启时抛错（调用方决定是收口还是提示）。 */
export async function sendMailShared(to: string, subject: string, html: string): Promise<void> {
  const { enabled, cfg } = await loadSmtpCfg()
  if (!enabled) throw new Error('未开启邮件服务')
  await smtpTransport(cfg).sendMail({ from: `"${cfg.fromName}" <${cfg.fromAddress}>`, to, subject, html })
}
