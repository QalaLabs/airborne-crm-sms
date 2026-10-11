-- Interconnect OS Phase 3: WhatsApp module
-- Additive only. Conversation/message/campaign stores for the WhatsApp admin
-- UI; providers (mock / Interakt) write these rows in later phases.

CREATE TYPE "WhatsAppMessageDirection" AS ENUM ('IN', 'OUT');

CREATE TABLE "whatsapp_conversations" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "phone" VARCHAR(20) NOT NULL,
    "leadId" UUID,
    "lastMessageAt" TIMESTAMP(3),
    "lastMessagePreview" VARCHAR(255),
    "unreadCount" INTEGER NOT NULL DEFAULT 0,
    "optedOut" BOOLEAN NOT NULL DEFAULT false,
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "whatsapp_conversations_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "whatsapp_messages" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "conversationId" UUID NOT NULL,
    "direction" "WhatsAppMessageDirection" NOT NULL,
    "body" TEXT NOT NULL,
    "templateName" VARCHAR(255),
    "status" VARCHAR(30) NOT NULL DEFAULT 'SENT',
    "externalId" VARCHAR(255),
    "errorMsg" TEXT,
    "sentBy" UUID,
    "campaignId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "whatsapp_messages_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "whatsapp_campaigns" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "message" TEXT NOT NULL,
    "templateName" VARCHAR(255),
    "audienceFilter" JSONB NOT NULL DEFAULT '{}',
    "status" VARCHAR(30) NOT NULL DEFAULT 'DRAFT',
    "totalRecipients" INTEGER NOT NULL DEFAULT 0,
    "sentCount" INTEGER NOT NULL DEFAULT 0,
    "failedCount" INTEGER NOT NULL DEFAULT 0,
    "skippedCount" INTEGER NOT NULL DEFAULT 0,
    "launchedBy" UUID,
    "launchedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "whatsapp_campaigns_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "whatsapp_conversations_orgId_phone_key" ON "whatsapp_conversations"("orgId", "phone");
CREATE INDEX "whatsapp_conversations_orgId_lastMessageAt_desc_idx" ON "whatsapp_conversations"("orgId", "lastMessageAt" DESC);
CREATE INDEX "whatsapp_conversations_leadId_idx" ON "whatsapp_conversations"("leadId");

CREATE INDEX "whatsapp_messages_conversationId_createdAt_idx" ON "whatsapp_messages"("conversationId", "createdAt");
CREATE INDEX "whatsapp_messages_orgId_createdAt_desc_idx" ON "whatsapp_messages"("orgId", "createdAt" DESC);

CREATE INDEX "whatsapp_campaigns_orgId_status_idx" ON "whatsapp_campaigns"("orgId", "status");

ALTER TABLE "whatsapp_conversations" ADD CONSTRAINT "whatsapp_conversations_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "whatsapp_conversations" ADD CONSTRAINT "whatsapp_conversations_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "leads"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "whatsapp_messages" ADD CONSTRAINT "whatsapp_messages_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "whatsapp_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "whatsapp_messages" ADD CONSTRAINT "whatsapp_messages_sentBy_fkey" FOREIGN KEY ("sentBy") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "whatsapp_campaigns" ADD CONSTRAINT "whatsapp_campaigns_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Contact-level opt-out kill switch
ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "whatsappOptOut" BOOLEAN NOT NULL DEFAULT false;
