-- Additive migration: LMS questions, quiz attempts, bookmarks, announcements
-- + passPercent/maxAttempts on lms_modules
-- + verificationCode on lms_certificates
-- + NOTES value on LmsContentType enum
-- SAFETY: No DROP TABLE, no DROP COLUMN, no TRUNCATE, no destructive ALTER TYPE.

-- 1. Extend LmsContentType enum with NOTES (additive value only)
ALTER TYPE "LmsContentType" ADD VALUE IF NOT EXISTS 'NOTES';

-- 2. Add passPercent and maxAttempts to lms_modules (additive columns with defaults)
ALTER TABLE "lms_modules"
  ADD COLUMN IF NOT EXISTS "passPercent" INTEGER NOT NULL DEFAULT 70,
  ADD COLUMN IF NOT EXISTS "maxAttempts" INTEGER NOT NULL DEFAULT 3;

-- 3. Add verificationCode to lms_certificates (additive nullable column)
ALTER TABLE "lms_certificates"
  ADD COLUMN IF NOT EXISTS "verificationCode" VARCHAR(100);

-- 4. Create lms_questions table
CREATE TABLE IF NOT EXISTS "lms_questions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "moduleId" UUID NOT NULL,
    "stem" TEXT NOT NULL,
    "options" JSONB NOT NULL DEFAULT '[]',
    "correctOptionId" VARCHAR(50) NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "points" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "lms_questions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "lms_questions_moduleId_order_idx" ON "lms_questions"("moduleId", "order");

ALTER TABLE "lms_questions"
  ADD CONSTRAINT "lms_questions_moduleId_fkey"
  FOREIGN KEY ("moduleId") REFERENCES "lms_modules"("id") ON DELETE CASCADE
  NOT VALID;

ALTER TABLE "lms_questions" VALIDATE CONSTRAINT "lms_questions_moduleId_fkey";

-- 5. Create lms_quiz_attempts table
CREATE TABLE IF NOT EXISTS "lms_quiz_attempts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "studentId" UUID NOT NULL,
    "userId" UUID,
    "moduleId" UUID NOT NULL,
    "answers" JSONB NOT NULL DEFAULT '{}',
    "score" INTEGER NOT NULL DEFAULT 0,
    "maxScore" INTEGER NOT NULL DEFAULT 0,
    "passed" BOOLEAN NOT NULL DEFAULT false,
    "attemptNumber" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "lms_quiz_attempts_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "lms_quiz_attempts_studentId_moduleId_idx" ON "lms_quiz_attempts"("studentId", "moduleId");
CREATE INDEX IF NOT EXISTS "lms_quiz_attempts_moduleId_idx" ON "lms_quiz_attempts"("moduleId");

ALTER TABLE "lms_quiz_attempts"
  ADD CONSTRAINT "lms_quiz_attempts_studentId_fkey"
  FOREIGN KEY ("studentId") REFERENCES "students"("id") ON DELETE CASCADE
  NOT VALID;

ALTER TABLE "lms_quiz_attempts" VALIDATE CONSTRAINT "lms_quiz_attempts_studentId_fkey";

ALTER TABLE "lms_quiz_attempts"
  ADD CONSTRAINT "lms_quiz_attempts_moduleId_fkey"
  FOREIGN KEY ("moduleId") REFERENCES "lms_modules"("id") ON DELETE CASCADE
  NOT VALID;

ALTER TABLE "lms_quiz_attempts" VALIDATE CONSTRAINT "lms_quiz_attempts_moduleId_fkey";

ALTER TABLE "lms_quiz_attempts"
  ADD CONSTRAINT "lms_quiz_attempts_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL
  NOT VALID;

ALTER TABLE "lms_quiz_attempts" VALIDATE CONSTRAINT "lms_quiz_attempts_userId_fkey";

-- 6. Create lms_bookmarks table
CREATE TABLE IF NOT EXISTS "lms_bookmarks" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "studentId" UUID NOT NULL,
    "topicId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "lms_bookmarks_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "lms_bookmarks_studentId_topicId_key" ON "lms_bookmarks"("studentId", "topicId");
CREATE INDEX IF NOT EXISTS "lms_bookmarks_studentId_idx" ON "lms_bookmarks"("studentId");

ALTER TABLE "lms_bookmarks"
  ADD CONSTRAINT "lms_bookmarks_studentId_fkey"
  FOREIGN KEY ("studentId") REFERENCES "students"("id") ON DELETE CASCADE
  NOT VALID;

ALTER TABLE "lms_bookmarks" VALIDATE CONSTRAINT "lms_bookmarks_studentId_fkey";

ALTER TABLE "lms_bookmarks"
  ADD CONSTRAINT "lms_bookmarks_topicId_fkey"
  FOREIGN KEY ("topicId") REFERENCES "lms_topics"("id") ON DELETE CASCADE
  NOT VALID;

ALTER TABLE "lms_bookmarks" VALIDATE CONSTRAINT "lms_bookmarks_topicId_fkey";

-- 7. Create lms_announcements table
CREATE TABLE IF NOT EXISTS "lms_announcements" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "orgId" UUID NOT NULL,
    "courseId" UUID,
    "title" VARCHAR(255) NOT NULL,
    "body" TEXT NOT NULL,
    "publishedAt" TIMESTAMP(3),
    "createdBy" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "lms_announcements_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "lms_announcements_orgId_publishedAt_idx" ON "lms_announcements"("orgId", "publishedAt" DESC);
CREATE INDEX IF NOT EXISTS "lms_announcements_courseId_idx" ON "lms_announcements"("courseId");

ALTER TABLE "lms_announcements"
  ADD CONSTRAINT "lms_announcements_orgId_fkey"
  FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE
  NOT VALID;

ALTER TABLE "lms_announcements" VALIDATE CONSTRAINT "lms_announcements_orgId_fkey";

ALTER TABLE "lms_announcements"
  ADD CONSTRAINT "lms_announcements_courseId_fkey"
  FOREIGN KEY ("courseId") REFERENCES "lms_courses"("id") ON DELETE SET NULL
  NOT VALID;

ALTER TABLE "lms_announcements" VALIDATE CONSTRAINT "lms_announcements_courseId_fkey";

ALTER TABLE "lms_announcements"
  ADD CONSTRAINT "lms_announcements_createdBy_fkey"
  FOREIGN KEY ("createdBy") REFERENCES "users"("id") ON DELETE SET NULL
  NOT VALID;

ALTER TABLE "lms_announcements" VALIDATE CONSTRAINT "lms_announcements_createdBy_fkey";
