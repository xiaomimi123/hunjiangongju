-- 素材支持图片：kind = video | image
ALTER TABLE "materials" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'video';
