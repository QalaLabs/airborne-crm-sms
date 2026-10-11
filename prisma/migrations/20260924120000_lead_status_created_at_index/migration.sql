-- Composite index for lead list filters sorted by createdAt (status + recency).
CREATE INDEX IF NOT EXISTS "leads_orgId_status_createdAt_idx"
  ON "leads" ("orgId", "status", "createdAt" DESC);
