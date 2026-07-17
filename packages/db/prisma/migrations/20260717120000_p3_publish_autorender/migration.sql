ALTER TABLE "copy_frameworks" ADD COLUMN "published" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "generation_tasks" ADD COLUMN "published" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "generation_tasks" ADD COLUMN "auto_render" BOOLEAN NOT NULL DEFAULT false;
