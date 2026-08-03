CREATE TABLE IF NOT EXISTS "stock_assets" (
  "id" TEXT PRIMARY KEY,
  "kind" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "folder" TEXT,
  "file_url" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
