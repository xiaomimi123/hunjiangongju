-- 配额改为按日：gen_used_date 记录当日计数属于哪一天（北京时间），跨天自动归零重记
ALTER TABLE "users" ADD COLUMN "gen_used_date" DATE;
