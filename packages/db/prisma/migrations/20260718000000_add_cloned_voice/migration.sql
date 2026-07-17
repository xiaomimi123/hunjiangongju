CREATE TABLE "cloned_voices" (
  "id" TEXT PRIMARY KEY, "voice_id" TEXT NOT NULL, "name" TEXT NOT NULL,
  "sample_asset_url" TEXT NOT NULL, "provider" TEXT NOT NULL DEFAULT 'dashscope',
  "created_by" TEXT, "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "cloned_voices_voice_id_key" ON "cloned_voices"("voice_id");
