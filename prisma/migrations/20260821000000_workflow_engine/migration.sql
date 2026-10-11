-- Interconnect OS Phase 1: workflow execution engine
-- Additive only - no DROP TABLE / DROP COLUMN.
-- Extends the existing Workflow / WorkflowRun models so the runner can:
--   * match canonical events via WorkflowTrigger (new enum values)
--   * reference workflows by stable code (START_WORKFLOW steps)
--   * dedupe event-triggered runs (dedupKey) and record stop reasons

ALTER TYPE "WorkflowTrigger" ADD VALUE IF NOT EXISTS 'LEAD_UPDATED';
ALTER TYPE "WorkflowTrigger" ADD VALUE IF NOT EXISTS 'APPLICATION_CREATED';
ALTER TYPE "WorkflowTrigger" ADD VALUE IF NOT EXISTS 'APPLICATION_APPROVED';
ALTER TYPE "WorkflowTrigger" ADD VALUE IF NOT EXISTS 'COURSE_ENROLLED';
ALTER TYPE "WorkflowTrigger" ADD VALUE IF NOT EXISTS 'PAYMENT_PENDING';
ALTER TYPE "WorkflowTrigger" ADD VALUE IF NOT EXISTS 'PAYMENT_FAILED';
ALTER TYPE "WorkflowTrigger" ADD VALUE IF NOT EXISTS 'PAYMENT_REFUNDED';
ALTER TYPE "WorkflowTrigger" ADD VALUE IF NOT EXISTS 'WHATSAPP_REPLIED';
ALTER TYPE "WorkflowTrigger" ADD VALUE IF NOT EXISTS 'WHATSAPP_OPTED_OUT';
ALTER TYPE "WorkflowTrigger" ADD VALUE IF NOT EXISTS 'EBOOK_DOWNLOADED';
ALTER TYPE "WorkflowTrigger" ADD VALUE IF NOT EXISTS 'CHATBOT_ESCALATED';
ALTER TYPE "WorkflowTrigger" ADD VALUE IF NOT EXISTS 'AI_CALL_COMPLETED';
ALTER TYPE "WorkflowTrigger" ADD VALUE IF NOT EXISTS 'CAMPUS_VISIT_BOOKED';

ALTER TABLE "workflows" ADD COLUMN IF NOT EXISTS "code" VARCHAR(100);
CREATE UNIQUE INDEX IF NOT EXISTS "workflows_orgId_code_key" ON "workflows"("orgId", "code");

ALTER TABLE "workflow_runs" ADD COLUMN IF NOT EXISTS "dedupKey" VARCHAR(255);
ALTER TABLE "workflow_runs" ADD COLUMN IF NOT EXISTS "stoppedReason" TEXT;

-- Partial-style dedup: Postgres unique indexes treat NULLs as distinct, so
-- manual runs (dedupKey NULL) are never blocked while event-triggered runs
-- with the same key are rejected (P2002 handled by the engine as "already run").
CREATE UNIQUE INDEX IF NOT EXISTS "workflow_runs_orgId_workflowId_entityType_entityId_dedupKey_key"
  ON "workflow_runs"("orgId", "workflowId", "entityType", "entityId", "dedupKey");

CREATE INDEX IF NOT EXISTS "workflow_runs_orgId_status_idx" ON "workflow_runs"("orgId", "status");
