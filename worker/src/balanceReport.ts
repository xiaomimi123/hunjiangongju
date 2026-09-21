// 每日生图余额/用量日报：北京时间每天 09:00 跑一次，发到 SiteConfig.alertEmail。
// 邮箱留空 = 不发；SMTP 未开启时打日志跳过（不炸 worker）。
// 余额低于告急线时主题带【告急】前缀，方便邮箱规则置顶。
import { prisma, queryPhotoBalance, sendMailShared, formatCredits, type PhotoBalance } from '@mixcut/db'

const ALERT_THRESHOLD_USD = 2
const BEIJING_OFFSET_MS = 8 * 3600_000
const SEND_HOUR_BEIJING = 9

/** 距下一个北京时间 09:00 的毫秒数（把当前时刻映射到北京钟轴上算差值即可） */
export function msUntilNextSend(now = Date.now()): number {
  const bj = now + BEIJING_OFFSET_MS
  const dayStart = Math.floor(bj / 86400_000) * 86400_000
  let next = dayStart + SEND_HOUR_BEIJING * 3600_000
  if (next <= bj) next += 86400_000
  return next - bj
}

type DayStats = { okRuns: number; okImages: number; failedRuns: number; consumedCc: number }

export function buildReport(balance: PhotoBalance | { error: string }, stats: DayStats): { subject: string; html: string } {
  const isErr = 'error' in balance
  const low = !isErr && !balance.unlimited && balance.remainUsd !== null && balance.remainUsd < ALERT_THRESHOLD_USD
  const balanceLine = isErr
    ? `余额查询失败：${balance.error}`
    : balance.unlimited
      ? '余额：不限额'
      : `余额：$${balance.remainUsd?.toFixed(4) ?? '?'}（累计已用 $${balance.usedUsd?.toFixed(2) ?? '?'}）`
  const subject = `${low ? '【告急】' : isErr ? '【异常】' : ''}生图服务日报 · ${balanceLine.replace('余额：', '余额 ')}`
  const html = `
<h3 style="margin:0 0 12px">东方文澜 · 生图服务日报</h3>
<p style="margin:0 0 6px;${low ? 'color:#d11f1a;font-weight:bold' : ''}">${balanceLine}${low ? ' —— 低于告急线 $' + ALERT_THRESHOLD_USD + '，请尽快充值' : ''}</p>
<p style="margin:0 0 6px">昨日（北京时间）：成功 ${stats.okRuns} 次 / ${stats.okImages} 张，失败 ${stats.failedRuns} 次，学员消耗 ${formatCredits(stats.consumedCc)} 积分</p>
<p style="margin:12px 0 0;color:#888;font-size:12px">按 $0.0085/张（1k）估算，昨日成本约 $${(stats.okImages * 0.0085).toFixed(2)}。此邮件由 worker 每天 09:00 自动发送；收件人在后台「系统设置 → 运营告警」修改，留空即停发。</p>`
  return { subject, html }
}

async function collectYesterdayStats(): Promise<DayStats> {
  // 北京时间的「昨天」窗口，换算回 UTC 存储时间
  const nowBj = Date.now() + BEIJING_OFFSET_MS
  const todayStartBj = Math.floor(nowBj / 86400_000) * 86400_000
  const from = new Date(todayStartBj - 86400_000 - BEIJING_OFFSET_MS)
  const to = new Date(todayStartBj - BEIJING_OFFSET_MS)

  const runs = await prisma.photoGenRun.findMany({
    where: { createdAt: { gte: from, lt: to } },
    select: { status: true, outputImages: true, creditsCost: true },
  })
  let okRuns = 0, okImages = 0, failedRuns = 0, consumedCc = 0
  for (const r of runs) {
    if (r.status === 'SUCCEEDED') {
      okRuns += 1
      okImages += Array.isArray(r.outputImages) ? r.outputImages.length : 0
      consumedCc += r.creditsCost
    } else if (r.status === 'FAILED') failedRuns += 1
  }
  return { okRuns, okImages, failedRuns, consumedCc }
}

export async function sendDailyBalanceReport(): Promise<void> {
  const site = await prisma.siteConfig.findUnique({ where: { id: 1 } })
  const to = site?.alertEmail?.trim()
  if (!to) return // 未配置收件人：静默跳过

  let balance: Parameters<typeof buildReport>[0]
  try {
    balance = await queryPhotoBalance()
  } catch (e) {
    balance = { error: (e as Error).message }
  }
  const stats = await collectYesterdayStats()
  const { subject, html } = buildReport(balance, stats)
  try {
    await sendMailShared(to, subject, html)
    console.log(`[balance-report] 日报已发送至 ${to}`)
  } catch (e) {
    console.error(`[balance-report] 发送失败（SMTP 未配置或不可用）: ${(e as Error).message}`)
  }
}

export function startBalanceReporter(): void {
  const schedule = () => {
    const delay = msUntilNextSend()
    setTimeout(async () => {
      await sendDailyBalanceReport().catch((e) => console.error(`[balance-report] ${(e as Error).message}`))
      schedule()
    }, delay)
    console.log(`[balance-report] 下次日报 ${Math.round(delay / 60000)} 分钟后`)
  }
  schedule()
}
