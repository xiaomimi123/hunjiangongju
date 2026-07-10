-- DropIndex
DROP INDEX "users_account_key";

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "email" TEXT NOT NULL,
ADD COLUMN     "nickname" TEXT,
ALTER COLUMN "account" DROP NOT NULL;

-- CreateTable
CREATE TABLE "smtp_config" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "host" TEXT NOT NULL DEFAULT '',
    "port" INTEGER NOT NULL DEFAULT 465,
    "secure" BOOLEAN NOT NULL DEFAULT true,
    "username" TEXT NOT NULL DEFAULT '',
    "password_enc" TEXT NOT NULL DEFAULT '',
    "from_address" TEXT NOT NULL DEFAULT '',
    "from_name" TEXT NOT NULL DEFAULT '投流工作台',
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "smtp_config_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_codes" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "code_hash" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "consumed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "email_codes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "email_codes_email_purpose_idx" ON "email_codes"("email", "purpose");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

