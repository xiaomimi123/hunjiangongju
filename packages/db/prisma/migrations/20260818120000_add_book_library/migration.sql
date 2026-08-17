CREATE TABLE IF NOT EXISTS "book_library" (
  "id" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "author" TEXT NOT NULL,
  "theme" TEXT,
  "points" TEXT,
  "source" TEXT NOT NULL DEFAULT 'ai',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "book_library_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "book_library_title_author_key" ON "book_library"("title", "author");
