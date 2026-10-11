-- Link fee plans to the canonical marketing Course (nullable: existing plans stay unmapped).
ALTER TABLE "fee_plans" ADD COLUMN IF NOT EXISTS "courseId" UUID;

CREATE INDEX IF NOT EXISTS "fee_plans_orgId_courseId_idx" ON "fee_plans" ("orgId", "courseId");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fee_plans_courseId_fkey') THEN
    ALTER TABLE "fee_plans"
      ADD CONSTRAINT "fee_plans_courseId_fkey"
      FOREIGN KEY ("courseId") REFERENCES "courses"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
