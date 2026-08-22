-- 学员生成配额：gen_limit 上限（NULL=不限），gen_used 已用（只增不减）
ALTER TABLE "users" ADD COLUMN "gen_limit" INTEGER;
ALTER TABLE "users" ADD COLUMN "gen_used" INTEGER NOT NULL DEFAULT 0;
