-- Phase 1B: FeePlan templates + optional Admission.feePlanId
-- Additive only - no DROP TABLE / DROP COLUMN

CREATE TABLE IF NOT EXISTS "fee_plans" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "orgId" UUID NOT NULL,
  "name" VARCHAR(255) NOT NULL,
  "description" TEXT,
  "currency" VARCHAR(3) NOT NULL DEFAULT 'INR',
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "fee_plans_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "fee_plan_items" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "feePlanId" UUID NOT NULL,
  "name" VARCHAR(255) NOT NULL,
  "amount" DECIMAL(10,2) NOT NULL,
  "dueOffsetDays" INTEGER NOT NULL DEFAULT 0,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "fee_plan_items_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "admissions"
  ADD COLUMN IF NOT EXISTS "feePlanId" UUID;

DO $$ BEGIN
  ALTER TABLE "fee_plans"
    ADD CONSTRAINT "fee_plans_orgId_fkey"
    FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "fee_plan_items"
    ADD CONSTRAINT "fee_plan_items_feePlanId_fkey"
    FOREIGN KEY ("feePlanId") REFERENCES "fee_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "admissions"
    ADD CONSTRAINT "admissions_feePlanId_fkey"
    FOREIGN KEY ("feePlanId") REFERENCES "fee_plans"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS "fee_plans_orgId_isActive_idx" ON "fee_plans"("orgId", "isActive");
CREATE INDEX IF NOT EXISTS "fee_plans_orgId_createdAt_idx" ON "fee_plans"("orgId", "createdAt" DESC);
CREATE INDEX IF NOT EXISTS "fee_plan_items_feePlanId_sortOrder_idx" ON "fee_plan_items"("feePlanId", "sortOrder");
CREATE INDEX IF NOT EXISTS "admissions_feePlanId_idx" ON "admissions"("feePlanId");
