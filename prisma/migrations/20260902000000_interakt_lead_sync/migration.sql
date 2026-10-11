-- Interakt Advanced control-plane mappings + per-lead track observability.

CREATE TABLE IF NOT EXISTS "interakt_automations" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "code" VARCHAR(80) NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "triggerEvent" VARCHAR(80) NOT NULL DEFAULT 'lead_created',
    "courseKey" VARCHAR(80),
    "leadSourceGroup" VARCHAR(80),
    "provider" VARCHAR(40) NOT NULL DEFAULT 'interakt',
    "workflowRef" VARCHAR(255),
    "campaignRef" VARCHAR(255),
    "templates" JSONB NOT NULL DEFAULT '[]',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "interakt_automations_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "interakt_automations_orgId_code_key"
    ON "interakt_automations"("orgId", "code");

CREATE INDEX IF NOT EXISTS "interakt_automations_orgId_isActive_idx"
    ON "interakt_automations"("orgId", "isActive");

ALTER TABLE "interakt_automations"
    ADD CONSTRAINT "interakt_automations_orgId_fkey"
    FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE IF NOT EXISTS "interakt_lead_syncs" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "leadId" UUID NOT NULL,
    "eventName" VARCHAR(80) NOT NULL,
    "status" VARCHAR(40) NOT NULL,
    "contactSynced" BOOLEAN NOT NULL DEFAULT false,
    "eventSent" BOOLEAN NOT NULL DEFAULT false,
    "courseKey" VARCHAR(80),
    "leadSource" VARCHAR(80),
    "skipReason" VARCHAR(255),
    "providerUserId" VARCHAR(255),
    "providerEventId" VARCHAR(255),
    "workflowRef" VARCHAR(255),
    "errorMessage" TEXT,
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "lastAttemptAt" TIMESTAMP(3),
    "succeededAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "interakt_lead_syncs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "interakt_lead_syncs_leadId_eventName_key"
    ON "interakt_lead_syncs"("leadId", "eventName");

CREATE INDEX IF NOT EXISTS "interakt_lead_syncs_org_status_updated_idx"
    ON "interakt_lead_syncs"("orgId", "status", "updatedAt" DESC);

CREATE INDEX IF NOT EXISTS "interakt_lead_syncs_org_event_sent_idx"
    ON "interakt_lead_syncs"("orgId", "eventName", "eventSent");

ALTER TABLE "interakt_lead_syncs"
    ADD CONSTRAINT "interakt_lead_syncs_leadId_fkey"
    FOREIGN KEY ("leadId") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "interakt_lead_syncs"
    ADD CONSTRAINT "interakt_lead_syncs_orgId_fkey"
    FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
