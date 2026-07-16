CREATE TABLE "source_videos" (
  "id" TEXT PRIMARY KEY, "douyin_share_url" TEXT NOT NULL, "video_file_url" TEXT,
  "status" TEXT NOT NULL DEFAULT 'CREATED', "created_by" TEXT, "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE "transcripts" (
  "id" TEXT PRIMARY KEY, "source_video_id" TEXT NOT NULL, "full_text" TEXT NOT NULL,
  "sentences" JSONB, "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE "scene_cuts" (
  "id" TEXT PRIMARY KEY, "source_video_id" TEXT NOT NULL, "cut_points_ms" INTEGER[]
);
CREATE TABLE "copy_frameworks" (
  "id" TEXT PRIMARY KEY, "source_video_id" TEXT, "name" TEXT, "industry_category" TEXT,
  "visual_style_type" TEXT NOT NULL DEFAULT 'ai_illustration', "render_template" TEXT,
  "overlay_template" JSONB, "framework_text" TEXT NOT NULL, "suggested_segment_count" INTEGER,
  "max_lines" INTEGER, "max_total_chars" INTEGER, "created_by" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE "generation_tasks" (
  "id" TEXT PRIMARY KEY, "framework_id" TEXT NOT NULL, "subject" TEXT NOT NULL, "variables" JSONB,
  "full_audio_url" TEXT, "body_timings" JSONB, "status" TEXT NOT NULL DEFAULT 'GEN_CREATED',
  "created_by" TEXT, "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_at" TIMESTAMP(3) NOT NULL
);
CREATE TABLE "generated_segments" (
  "id" TEXT PRIMARY KEY, "generation_task_id" TEXT NOT NULL, "seq_no" INTEGER NOT NULL,
  "script_text" TEXT NOT NULL, "image_url" TEXT
);
CREATE TABLE "bgm_library" (
  "id" TEXT PRIMARY KEY, "file_url" TEXT NOT NULL, "style_tag" TEXT, "duration_ms" INTEGER
);
CREATE TABLE "render_tasks" (
  "id" TEXT PRIMARY KEY, "generation_task_id" TEXT NOT NULL, "bgm_id" TEXT,
  "status" TEXT NOT NULL DEFAULT 'RENDERING', "video_url" TEXT, "subtitle_url" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE "render_status_logs" (
  "id" TEXT PRIMARY KEY, "render_task_id" TEXT NOT NULL, "from_status" TEXT, "to_status" TEXT NOT NULL,
  "note" TEXT, "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE "render_qc_reports" (
  "id" TEXT PRIMARY KEY, "render_task_id" TEXT NOT NULL, "check_type" TEXT NOT NULL, "result" TEXT NOT NULL,
  "detail" TEXT, "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE "ai_capability_config" (
  "capability" TEXT PRIMARY KEY, "base_url" TEXT NOT NULL DEFAULT '', "api_key_enc" TEXT NOT NULL DEFAULT '',
  "model" TEXT NOT NULL DEFAULT '', "enabled" BOOLEAN NOT NULL DEFAULT false, "extra" JSONB, "updated_at" TIMESTAMP(3) NOT NULL
);
-- 外键
ALTER TABLE "transcripts" ADD CONSTRAINT "transcripts_src_fkey" FOREIGN KEY ("source_video_id") REFERENCES "source_videos"("id") ON DELETE CASCADE;
ALTER TABLE "scene_cuts" ADD CONSTRAINT "scene_cuts_src_fkey" FOREIGN KEY ("source_video_id") REFERENCES "source_videos"("id") ON DELETE CASCADE;
ALTER TABLE "copy_frameworks" ADD CONSTRAINT "copy_frameworks_src_fkey" FOREIGN KEY ("source_video_id") REFERENCES "source_videos"("id") ON DELETE SET NULL;
ALTER TABLE "generation_tasks" ADD CONSTRAINT "generation_tasks_fw_fkey" FOREIGN KEY ("framework_id") REFERENCES "copy_frameworks"("id") ON DELETE RESTRICT;
ALTER TABLE "generated_segments" ADD CONSTRAINT "generated_segments_task_fkey" FOREIGN KEY ("generation_task_id") REFERENCES "generation_tasks"("id") ON DELETE CASCADE;
ALTER TABLE "render_tasks" ADD CONSTRAINT "render_tasks_task_fkey" FOREIGN KEY ("generation_task_id") REFERENCES "generation_tasks"("id") ON DELETE CASCADE;
ALTER TABLE "render_tasks" ADD CONSTRAINT "render_tasks_bgm_fkey" FOREIGN KEY ("bgm_id") REFERENCES "bgm_library"("id") ON DELETE SET NULL;
ALTER TABLE "render_status_logs" ADD CONSTRAINT "rsl_task_fkey" FOREIGN KEY ("render_task_id") REFERENCES "render_tasks"("id") ON DELETE CASCADE;
ALTER TABLE "render_qc_reports" ADD CONSTRAINT "rqr_task_fkey" FOREIGN KEY ("render_task_id") REFERENCES "render_tasks"("id") ON DELETE CASCADE;
