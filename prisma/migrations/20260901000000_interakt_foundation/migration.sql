-- Interakt foundation: outbound correlation columns + webhook dedup table.

ALTER TABLE "whatsapp_messages" ADD COLUMN IF NOT EXISTS "leadId" UUID;
ALTER TABLE "whatsapp_messages" ADD COLUMN IF NOT EXISTS "workflowRunId" UUID;
ALTER TABLE "whatsapp_messages" ADD COLUMN IF NOT EXISTS "workflowStepKey" VARCHAR(64);
ALTER TABLE "whatsapp_messages" ADD COLUMN IF NOT EXISTS "idempotencyKey" VARCHAR(255);
ALTER TABLE "whatsapp_messages" ADD COLUMN IF NOT EXISTS "metadata" JSONB NOT NULL DEFAULT '{}';

CREATE INDEX IF NOT EXISTS "whatsapp_messages_orgId_externalId_idx"
  ON "whatsapp_messages"("orgId", "externalId");

CREATE UNIQUE INDEX IF NOT EXISTS "wa_messages_idempotency_key"
  ON "whatsapp_messages"("orgId", "idempotencyKey");

CREATE TABLE IF NOT EXISTS "whatsapp_provider_events" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "provider" VARCHAR(40) NOT NULL,
    "eventType" VARCHAR(80) NOT NULL,
    "providerEventId" VARCHAR(255) NOT NULL,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "whatsapp_provider_events_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "wa_provider_events_dedup_key"
  ON "whatsapp_provider_events"("orgId", "provider", "eventType", "providerEventId");

CREATE INDEX IF NOT EXISTS "whatsapp_provider_events_orgId_createdAt_desc_idx"
  ON "whatsapp_provider_events"("orgId", "createdAt" DESC);

ALTER TABLE "whatsapp_provider_events"
  ADD CONSTRAINT "whatsapp_provider_events_orgId_fkey"
  FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
