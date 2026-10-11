-- Multiple inbound webhook keys per org (e.g. one per Google Ads lead form), each with its own expiry.
CREATE TABLE IF NOT EXISTS "integration_keys" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "provider" VARCHAR(50) NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "keyHash" VARCHAR(64) NOT NULL,
    "keyPreview" VARCHAR(20) NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "lastUsedAt" TIMESTAMP(3),
    "createdBy" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "integration_keys_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "integration_keys_keyHash_key" ON "integration_keys" ("keyHash");
CREATE INDEX IF NOT EXISTS "integration_keys_orgId_provider_idx" ON "integration_keys" ("orgId", "provider");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'integration_keys_orgId_fkey') THEN
    ALTER TABLE "integration_keys"
      ADD CONSTRAINT "integration_keys_orgId_fkey"
      FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
