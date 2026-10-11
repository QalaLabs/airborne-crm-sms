-- Database-backed automation engine (replaces Inngest for workflow execution).

ALTER TABLE "workflow_runs" ADD COLUMN IF NOT EXISTS "nextRunAt" TIMESTAMP(3);
ALTER TABLE "workflow_runs" ADD COLUMN IF NOT EXISTS "retryCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "workflow_runs" ADD COLUMN IF NOT EXISTS "pausedAt" TIMESTAMP(3);
ALTER TABLE "workflow_runs" ADD COLUMN IF NOT EXISTS "stoppedAt" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "workflow_runs_status_nextRunAt_idx" ON "workflow_runs"("status", "nextRunAt");

CREATE TABLE IF NOT EXISTS "internal_events" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "requestId" VARCHAR(255) NOT NULL,
    "actorId" VARCHAR(255),
    "actorName" VARCHAR(255),
    "payload" JSONB NOT NULL DEFAULT '{}',
    "processedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "internal_events_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "internal_events_dedup" ON "internal_events"("orgId", "name", "requestId");
CREATE INDEX IF NOT EXISTS "internal_events_orgId_createdAt_idx" ON "internal_events"("orgId", "createdAt" DESC);
CREATE INDEX IF NOT EXISTS "internal_events_processedAt_idx" ON "internal_events"("processedAt");

ALTER TABLE "internal_events" ADD CONSTRAINT "internal_events_orgId_fkey"
    FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
