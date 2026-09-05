-- 扣子工具：演示视频 + 教学视频（后台上传，学员端工具页展示）。纯加列，秒级无锁。
ALTER TABLE "coze_tools" ADD COLUMN "demo_video_url" TEXT;
ALTER TABLE "coze_tools" ADD COLUMN "tutorial_video_url" TEXT;
