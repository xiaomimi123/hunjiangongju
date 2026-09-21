-- 积分精度升级：全库积分字段单位从「1 积分」改为「0.01 积分」（厘分记账）。
-- 存量数值一次性 ×100；新用户默认 30 积分 = 3000。显示层统一 /100。
ALTER TABLE "users" ALTER COLUMN "credits" SET DEFAULT 3000;
UPDATE "users" SET "credits" = "credits" * 100;
UPDATE "credit_logs" SET "delta" = "delta" * 100;
UPDATE "coze_tools" SET "price_credits" = "price_credits" * 100;
UPDATE "coze_tool_runs" SET "credits_cost" = "credits_cost" * 100;
UPDATE "photo_gen_runs" SET "credits_cost" = "credits_cost" * 100;
-- 视频单价可配置（默认 1 积分 = 100）
ALTER TABLE "site_config" ADD COLUMN "video_price_cc" INTEGER NOT NULL DEFAULT 100;
