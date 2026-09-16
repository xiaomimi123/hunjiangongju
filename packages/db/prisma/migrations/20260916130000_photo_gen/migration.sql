-- AI 实拍生图运行表。纯新增，不碰现有数据。
CREATE TABLE "photo_gen_runs" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "shot_mode" TEXT,
    "style" TEXT,
    "count" INTEGER NOT NULL DEFAULT 1,
    "input_image" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "output_images" JSONB,
    "error_msg" TEXT,
    "credits_cost" INTEGER NOT NULL DEFAULT 0,
    "refunded" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMP(3),
    CONSTRAINT "photo_gen_runs_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "photo_gen_runs_user_id_created_at_idx" ON "photo_gen_runs"("user_id", "created_at");
