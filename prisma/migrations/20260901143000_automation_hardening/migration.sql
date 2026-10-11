-- Production hardening: atomic execution leases + durable event processing.

ALTER TABLE "workflow_runs" ADD COLUMN IF NOT EXISTS "executionOwner" VARCHAR(128);
ALTER TABLE "workflow_runs" ADD COLUMN IF NOT EXISTS "executionLeaseUntil" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "workflow_runs_execution_lease_idx"
  ON "workflow_runs"("status", "executionLeaseUntil");

ALTER TABLE "internal_events" ADD COLUMN IF NOT EXISTS "attemptCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "internal_events" ADD COLUMN IF NOT EXISTS "lastError" TEXT;
ALTER TABLE "internal_events" ADD COLUMN IF NOT EXISTS "nextAttemptAt" TIMESTAMP(3);
ALTER TABLE "internal_events" ADD COLUMN IF NOT EXISTS "failedAt" TIMESTAMP(3);
ALTER TABLE "internal_events" ADD COLUMN IF NOT EXISTS "processingOwner" VARCHAR(128);
ALTER TABLE "internal_events" ADD COLUMN IF NOT EXISTS "processingLeaseUntil" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "internal_events_pending_idx"
  ON "internal_events"("processedAt", "failedAt", "nextAttemptAt");
