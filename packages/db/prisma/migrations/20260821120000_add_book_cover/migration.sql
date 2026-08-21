-- 书库存书封：同一本书的封面只做一次，之后所有片子复用。
-- cover_url  ：/api/files/... 形式的相对 URL（与 stock_assets.file_url 同口径）
-- cover_source：'upload'=运营上传的真实封面 / 'ai'=按框架画风生成的底图
ALTER TABLE "book_library" ADD COLUMN IF NOT EXISTS "cover_url" TEXT;
ALTER TABLE "book_library" ADD COLUMN IF NOT EXISTS "cover_source" TEXT;
