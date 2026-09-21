-- 框架级生成定价：null = 用全局视频单价。纯加列，秒级无锁。
ALTER TABLE "copy_frameworks" ADD COLUMN "price_cc" INTEGER;
