-- 积分制替换按日配额：1 条视频 = 1 积分；新账号送 30（ADD COLUMN DEFAULT 让存量学员也拿到 30）；
-- 用完由导师后台充值（credit_logs 记流水）。二维码存 site_config 单例。
ALTER TABLE "users" DROP COLUMN "gen_limit";
ALTER TABLE "users" DROP COLUMN "gen_used";
ALTER TABLE "users" DROP COLUMN "gen_used_date";
ALTER TABLE "users" ADD COLUMN "credits" INTEGER NOT NULL DEFAULT 30;

CREATE TABLE "credit_logs" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "delta" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "operator_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "credit_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "credit_logs_user_id_idx" ON "credit_logs"("user_id");

CREATE TABLE "site_config" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "recharge_qr_url" TEXT NOT NULL DEFAULT '',
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "site_config_pkey" PRIMARY KEY ("id")
);
