-- CreateTable
CREATE TABLE "plaid_items" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "item_id" TEXT NOT NULL,
    "access_token_encrypted" TEXT NOT NULL,
    "institution_name" TEXT NOT NULL,
    "cursor" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "plaid_items_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "accounts" ADD COLUMN "plaid_item_id" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "plaid_items_item_id_key" ON "plaid_items"("item_id");

-- CreateIndex
CREATE INDEX "plaid_items_user_id_idx" ON "plaid_items"("user_id");

-- CreateIndex
CREATE INDEX "accounts_plaid_item_id_idx" ON "accounts"("plaid_item_id");

-- AddForeignKey
ALTER TABLE "plaid_items" ADD CONSTRAINT "plaid_items_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_plaid_item_id_fkey" FOREIGN KEY ("plaid_item_id") REFERENCES "plaid_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ── Row Level Security (mirror 0002_enable_rls) ───────────────────────────
-- plaid_items stores encrypted Plaid access tokens and is user-scoped. FORCE
-- makes the table owner subject to policies too, matching the rest of Clarifi's
-- RLS posture.
ALTER TABLE "plaid_items" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "plaid_items" FORCE ROW LEVEL SECURITY;
CREATE POLICY "plaid_items_isolation" ON "plaid_items" FOR ALL
  USING ("user_id" = NULLIF(current_setting('app.current_user_id', true), ''))
  WITH CHECK ("user_id" = NULLIF(current_setting('app.current_user_id', true), ''));
