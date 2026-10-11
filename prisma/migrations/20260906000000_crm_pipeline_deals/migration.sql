-- SECTION 3 — CRM PIPELINE: DEAL / OPPORTUNITY + canonical status additions
-- Additive, non-destructive. No backfill of deals from admissions: deals are a
-- new business entity and must not be fabricated from historical data.

-- 1) LeadStatus: add the client-requested lost taxonomy.
--    - NOT_INTERESTED   → legacy-referenced status (was already present in the
--      UI color map but missing from the DB enum — that mismatch is fixed here).
--    - REASON_NOT_SHARED → "Lost → Not Interested → Reason Not Shared" is a
--      real persisted status/reason, not just a UI label.
ALTER TYPE "public"."LeadStatus" ADD VALUE 'NOT_INTERESTED';
ALTER TYPE "public"."LeadStatus" ADD VALUE 'REASON_NOT_SHARED';

-- 2) WorkflowTrigger: deal lifecycle triggers for the workflow engine
--    (matched through src/lib/events/catalog.ts).
ALTER TYPE "public"."WorkflowTrigger" ADD VALUE 'DEAL_CREATED';
ALTER TYPE "public"."WorkflowTrigger" ADD VALUE 'DEAL_STAGE_CHANGED';

-- 3) Deals / Opportunities table.
CREATE TABLE "public"."deals" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "leadId" UUID NOT NULL,
    "admissionId" UUID,
    "title" VARCHAR(255) NOT NULL,
    "stage" "public"."AdmissionStage" NOT NULL DEFAULT 'ENQUIRY',
    "value" DECIMAL(12, 2),
    "currency" VARCHAR(3) NOT NULL DEFAULT 'INR',
    "expectedCloseAt" TIMESTAMP(3),
    "source" "public"."LeadSource",
    "assignedTo" UUID,
    "createdBy" UUID,
    "notes" TEXT,
    "lostReason" TEXT,
    "wonAt" TIMESTAMP(3),
    "lostAt" TIMESTAMP(3),
    "convertedAt" TIMESTAMP(3),
    "revertedAt" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "deals_pkey" PRIMARY KEY ("id")
);

-- Concurrency guards:
--  - (orgId, leadId) unique → two simultaneous Prospect→Deal conversions can
--    never create two Deals for the same lead.
--  - admissionId unique-non-null (partial) → two simultaneous Deal→Admission
--    conversions can never create two Admissions for the same Deal.
CREATE UNIQUE INDEX "deals_orgId_leadId_key" ON "public"."deals"("orgId", "leadId");
CREATE UNIQUE INDEX "deals_admissionId_key" ON "public"."deals"("admissionId");

CREATE INDEX "deals_orgId_stage_idx" ON "public"."deals"("orgId", "stage");
CREATE INDEX "deals_orgId_isActive_stage_idx" ON "public"."deals"("orgId", "isActive", "stage");
CREATE INDEX "deals_orgId_assignedTo_idx" ON "public"."deals"("orgId", "assignedTo");
CREATE INDEX "deals_orgId_createdAt_idx" ON "public"."deals"("orgId", "createdAt" DESC);
CREATE INDEX "deals_orgId_wonAt_idx" ON "public"."deals"("orgId", "wonAt");
CREATE INDEX "deals_orgId_updatedAt_idx" ON "public"."deals"("orgId", "updatedAt" DESC);

ALTER TABLE "public"."deals" ADD CONSTRAINT "deals_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "public"."organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "public"."deals" ADD CONSTRAINT "deals_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "public"."leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "public"."deals" ADD CONSTRAINT "deals_admissionId_fkey" FOREIGN KEY ("admissionId") REFERENCES "public"."admissions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "public"."deals" ADD CONSTRAINT "deals_assignedTo_fkey" FOREIGN KEY ("assignedTo") REFERENCES "public"."users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "public"."deals" ADD CONSTRAINT "deals_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "public"."users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 4) LeadActivity: optional dealId so deal lifecycle events are visible on the
--    shared lead timeline (single timeline system, not a parallel one).
ALTER TABLE "public"."lead_activities" ADD COLUMN "dealId" UUID;

ALTER TABLE "public"."lead_activities" ADD CONSTRAINT "lead_activities_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "public"."deals"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "lead_activities_dealId_createdAt_idx" ON "public"."lead_activities"("dealId", "createdAt" DESC);