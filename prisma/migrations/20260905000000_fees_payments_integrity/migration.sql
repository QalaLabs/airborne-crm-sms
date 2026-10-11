-- SECTION 2 - Fees / Payments / Ledger / Financial Integrity
--
-- 1. PaymentTransaction:
--    - idempotencyKey (nullable unique per org) for idempotent double-submit protection.
--    - refund accounting columns (refunded_amount / refunded_at / refunded_by).
--    - receiptNo unique per org (guaranteed by payment_receipt_seq nextval).
-- 2. FeePlanItem.percent_of_fee: percent-of-course-fee item type.

CREATE SEQUENCE IF NOT EXISTS "payment_receipt_seq";

-- Seed the sequence past the highest existing RCP receipt number so reusing an
-- existing database never collides with historical receipts.
DO $$
DECLARE
  max_seq BIGINT;
BEGIN
  SELECT COALESCE(MAX(SPLIT_PART("receiptNo", '-', 3)::BIGINT), 0)
  INTO max_seq
  FROM "payment_transactions"
  WHERE "receiptNo" IS NOT NULL
    AND "receiptNo" ~ '^RCP-[0-9]{6}-[0-9]+$';

  -- Fresh databases have no receipts (max_seq = 0): seed the floor at 1.
  PERFORM setval('payment_receipt_seq', GREATEST(max_seq, 1), false);
END $$;

-- PaymentTransaction: idempotency + refunds
ALTER TABLE "payment_transactions" ADD COLUMN "idempotencyKey" VARCHAR(255);
ALTER TABLE "payment_transactions" ADD COLUMN "refundedAmount" DECIMAL(10,2) NOT NULL DEFAULT 0;
ALTER TABLE "payment_transactions" ADD COLUMN "refundedAt" TIMESTAMP(3);
ALTER TABLE "payment_transactions" ADD COLUMN "refundedBy" UUID;

CREATE UNIQUE INDEX "payment_transactions_orgId_idempotencyKey_key" ON "public"."payment_transactions"("orgId" ASC, "idempotencyKey" ASC);
CREATE UNIQUE INDEX "payment_transactions_orgId_receiptNo_key" ON "public"."payment_transactions"("orgId" ASC, "receiptNo" ASC);
CREATE INDEX "payment_transactions_orgId_refundedAt_idx" ON "public"."payment_transactions"("orgId" ASC, "refundedAt" DESC);

ALTER TABLE "payment_transactions" ADD CONSTRAINT "payment_transactions_refundedBy_fkey" FOREIGN KEY ("refundedBy") REFERENCES "public"."users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill historical refunds. REFUNDED / PARTIALLY_REFUNDED rows currently drop out of
-- feePaid entirely (net zero). Record the full amount as refunded to preserve today's
-- money math; the Section 2 reconciliation run flags PARTIALLY_REFUNDED rows for manual review.
UPDATE "payment_transactions"
SET "refundedAmount" = "amount",
    "refundedAt" = COALESCE("refundedAt", "paidAt", "createdAt")
WHERE "status" IN ('REFUNDED', 'PARTIALLY_REFUNDED')
  AND "refundedAmount" = 0;

-- FeePlanItem: percent-of-course-fee item type
ALTER TABLE "fee_plan_items" ADD COLUMN "percentOfFee" DECIMAL(5,2);