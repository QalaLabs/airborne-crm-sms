-- Phase C: batches, timetable, assignments, question bank enhancements, curriculum fields
-- Additive only - no DROP TABLE / DROP COLUMN

-- Enums
DO $$ BEGIN
  CREATE TYPE "LmsBatchType" AS ENUM ('MORNING', 'EVENING', 'WEEKEND', 'CUSTOM');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "LmsQuestionDifficulty" AS ENUM ('EASY', 'MEDIUM', 'HARD');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "LmsAssignmentStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'CLOSED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "LmsSubmissionStatus" AS ENUM ('SUBMITTED', 'GRADED', 'RETURNED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Extend LmsContentType with ATTACHMENT
DO $$ BEGIN
  ALTER TYPE "LmsContentType" ADD VALUE IF NOT EXISTS 'ATTACHMENT';
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Module quiz set config
ALTER TABLE "lms_modules"
  ADD COLUMN IF NOT EXISTS "quizQuestionCount" INTEGER,
  ADD COLUMN IF NOT EXISTS "randomizeQuestions" BOOLEAN NOT NULL DEFAULT false;

-- Content rich body
ALTER TABLE "lms_contents"
  ADD COLUMN IF NOT EXISTS "body" TEXT;

-- Question bank enhancements
ALTER TABLE "lms_questions"
  ADD COLUMN IF NOT EXISTS "difficulty" "LmsQuestionDifficulty" NOT NULL DEFAULT 'MEDIUM',
  ADD COLUMN IF NOT EXISTS "negativePoints" INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS "lms_questions_moduleId_difficulty_idx"
  ON "lms_questions"("moduleId", "difficulty");

-- Batches
CREATE TABLE IF NOT EXISTS "lms_batches" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "orgId" UUID NOT NULL,
  "courseId" UUID NOT NULL,
  "name" VARCHAR(255) NOT NULL,
  "type" "LmsBatchType" NOT NULL DEFAULT 'CUSTOM',
  "startDate" TIMESTAMP(3),
  "endDate" TIMESTAMP(3),
  "capacity" INTEGER,
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "lms_batches_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "lms_batches_orgId_courseId_idx" ON "lms_batches"("orgId", "courseId");
CREATE INDEX IF NOT EXISTS "lms_batches_orgId_type_idx" ON "lms_batches"("orgId", "type");

DO $$ BEGIN
  ALTER TABLE "lms_batches" ADD CONSTRAINT "lms_batches_orgId_fkey"
    FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "lms_batches" ADD CONSTRAINT "lms_batches_courseId_fkey"
    FOREIGN KEY ("courseId") REFERENCES "lms_courses"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "lms_batch_teachers" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "batchId" UUID NOT NULL,
  "teacherId" UUID NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "lms_batch_teachers_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "lms_batch_teachers_batchId_teacherId_key"
  ON "lms_batch_teachers"("batchId", "teacherId");
CREATE INDEX IF NOT EXISTS "lms_batch_teachers_teacherId_idx" ON "lms_batch_teachers"("teacherId");

DO $$ BEGIN
  ALTER TABLE "lms_batch_teachers" ADD CONSTRAINT "lms_batch_teachers_batchId_fkey"
    FOREIGN KEY ("batchId") REFERENCES "lms_batches"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "lms_batch_teachers" ADD CONSTRAINT "lms_batch_teachers_teacherId_fkey"
    FOREIGN KEY ("teacherId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "lms_batch_students" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "batchId" UUID NOT NULL,
  "studentId" UUID NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "lms_batch_students_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "lms_batch_students_batchId_studentId_key"
  ON "lms_batch_students"("batchId", "studentId");
CREATE INDEX IF NOT EXISTS "lms_batch_students_studentId_idx" ON "lms_batch_students"("studentId");

DO $$ BEGIN
  ALTER TABLE "lms_batch_students" ADD CONSTRAINT "lms_batch_students_batchId_fkey"
    FOREIGN KEY ("batchId") REFERENCES "lms_batches"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "lms_batch_students" ADD CONSTRAINT "lms_batch_students_studentId_fkey"
    FOREIGN KEY ("studentId") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Enrollment optional batch
ALTER TABLE "lms_enrollments"
  ADD COLUMN IF NOT EXISTS "batchId" UUID;

CREATE INDEX IF NOT EXISTS "lms_enrollments_batchId_idx" ON "lms_enrollments"("batchId");

DO $$ BEGIN
  ALTER TABLE "lms_enrollments" ADD CONSTRAINT "lms_enrollments_batchId_fkey"
    FOREIGN KEY ("batchId") REFERENCES "lms_batches"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Timetable
CREATE TABLE IF NOT EXISTS "lms_timetable_slots" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "orgId" UUID NOT NULL,
  "batchId" UUID NOT NULL,
  "courseId" UUID,
  "teacherId" UUID,
  "title" VARCHAR(255) NOT NULL,
  "startsAt" TIMESTAMP(3) NOT NULL,
  "endsAt" TIMESTAMP(3) NOT NULL,
  "room" VARCHAR(100),
  "onlineUrl" TEXT,
  "subjectTag" VARCHAR(100),
  "recurrenceRule" JSONB NOT NULL DEFAULT '{}',
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "lms_timetable_slots_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "lms_timetable_slots_orgId_startsAt_idx" ON "lms_timetable_slots"("orgId", "startsAt");
CREATE INDEX IF NOT EXISTS "lms_timetable_slots_batchId_startsAt_idx" ON "lms_timetable_slots"("batchId", "startsAt");
CREATE INDEX IF NOT EXISTS "lms_timetable_slots_teacherId_startsAt_idx" ON "lms_timetable_slots"("teacherId", "startsAt");

DO $$ BEGIN
  ALTER TABLE "lms_timetable_slots" ADD CONSTRAINT "lms_timetable_slots_orgId_fkey"
    FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "lms_timetable_slots" ADD CONSTRAINT "lms_timetable_slots_batchId_fkey"
    FOREIGN KEY ("batchId") REFERENCES "lms_batches"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "lms_timetable_slots" ADD CONSTRAINT "lms_timetable_slots_courseId_fkey"
    FOREIGN KEY ("courseId") REFERENCES "lms_courses"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "lms_timetable_slots" ADD CONSTRAINT "lms_timetable_slots_teacherId_fkey"
    FOREIGN KEY ("teacherId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Attendance session batch / timetable / subject
ALTER TABLE "lms_attendance_sessions"
  ADD COLUMN IF NOT EXISTS "batchId" UUID,
  ADD COLUMN IF NOT EXISTS "timetableSlotId" UUID,
  ADD COLUMN IF NOT EXISTS "subjectTag" VARCHAR(100);

CREATE INDEX IF NOT EXISTS "lms_attendance_sessions_batchId_idx" ON "lms_attendance_sessions"("batchId");

DO $$ BEGIN
  ALTER TABLE "lms_attendance_sessions" ADD CONSTRAINT "lms_attendance_sessions_batchId_fkey"
    FOREIGN KEY ("batchId") REFERENCES "lms_batches"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "lms_attendance_sessions" ADD CONSTRAINT "lms_attendance_sessions_timetableSlotId_fkey"
    FOREIGN KEY ("timetableSlotId") REFERENCES "lms_timetable_slots"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Assignments
CREATE TABLE IF NOT EXISTS "lms_assignments" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "orgId" UUID NOT NULL,
  "courseId" UUID NOT NULL,
  "batchId" UUID,
  "moduleId" UUID,
  "title" VARCHAR(255) NOT NULL,
  "description" TEXT,
  "dueAt" TIMESTAMP(3),
  "maxScore" INTEGER NOT NULL DEFAULT 100,
  "status" "LmsAssignmentStatus" NOT NULL DEFAULT 'DRAFT',
  "createdBy" UUID,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "lms_assignments_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "lms_assignments_orgId_courseId_idx" ON "lms_assignments"("orgId", "courseId");
CREATE INDEX IF NOT EXISTS "lms_assignments_batchId_idx" ON "lms_assignments"("batchId");
CREATE INDEX IF NOT EXISTS "lms_assignments_status_idx" ON "lms_assignments"("status");

DO $$ BEGIN
  ALTER TABLE "lms_assignments" ADD CONSTRAINT "lms_assignments_orgId_fkey"
    FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "lms_assignments" ADD CONSTRAINT "lms_assignments_courseId_fkey"
    FOREIGN KEY ("courseId") REFERENCES "lms_courses"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "lms_assignments" ADD CONSTRAINT "lms_assignments_batchId_fkey"
    FOREIGN KEY ("batchId") REFERENCES "lms_batches"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "lms_assignments" ADD CONSTRAINT "lms_assignments_moduleId_fkey"
    FOREIGN KEY ("moduleId") REFERENCES "lms_modules"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "lms_assignments" ADD CONSTRAINT "lms_assignments_createdBy_fkey"
    FOREIGN KEY ("createdBy") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "lms_assignment_submissions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "assignmentId" UUID NOT NULL,
  "studentId" UUID NOT NULL,
  "fileUrl" TEXT,
  "body" TEXT,
  "score" INTEGER,
  "status" "LmsSubmissionStatus" NOT NULL DEFAULT 'SUBMITTED',
  "feedback" TEXT,
  "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "gradedAt" TIMESTAMP(3),
  "gradedBy" UUID,
  CONSTRAINT "lms_assignment_submissions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "lms_assignment_submissions_assignmentId_studentId_key"
  ON "lms_assignment_submissions"("assignmentId", "studentId");
CREATE INDEX IF NOT EXISTS "lms_assignment_submissions_studentId_idx"
  ON "lms_assignment_submissions"("studentId");

DO $$ BEGIN
  ALTER TABLE "lms_assignment_submissions" ADD CONSTRAINT "lms_assignment_submissions_assignmentId_fkey"
    FOREIGN KEY ("assignmentId") REFERENCES "lms_assignments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "lms_assignment_submissions" ADD CONSTRAINT "lms_assignment_submissions_studentId_fkey"
    FOREIGN KEY ("studentId") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "lms_assignment_submissions" ADD CONSTRAINT "lms_assignment_submissions_gradedBy_fkey"
    FOREIGN KEY ("gradedBy") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
