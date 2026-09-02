-- CreateTable
CREATE TABLE "coze_tools" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "workflow_id" TEXT NOT NULL,
    "inputs" JSONB NOT NULL,
    "price_credits" INTEGER NOT NULL DEFAULT 1,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "coze_tools_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "coze_tool_runs" (
    "id" TEXT NOT NULL,
    "tool_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "inputs" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "output_raw" JSONB,
    "output_items" JSONB,
    "error_msg" TEXT,
    "credits_cost" INTEGER NOT NULL,
    "refunded" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMP(3),

    CONSTRAINT "coze_tool_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "coze_tool_runs_user_id_created_at_idx" ON "coze_tool_runs"("user_id", "created_at");
