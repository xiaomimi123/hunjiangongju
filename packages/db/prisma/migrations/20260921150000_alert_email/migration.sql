-- 运营告警邮箱（每日余额/用量日报收件人）。纯加列。
ALTER TABLE "site_config" ADD COLUMN "alert_email" TEXT NOT NULL DEFAULT '';
