-- 会话代次：改密码 / 重置密码时 +1，使该用户所有已签发的旧 token 立即失效。
-- 默认值 0 与「旧 token 没有 epoch claim 时按 0 处理」对齐，存量登录不受影响。
ALTER TABLE "users" ADD COLUMN "session_epoch" INTEGER NOT NULL DEFAULT 0;
