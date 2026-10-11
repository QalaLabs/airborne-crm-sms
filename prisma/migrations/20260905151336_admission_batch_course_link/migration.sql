-- DropForeignKey
ALTER TABLE "lms_announcements" DROP CONSTRAINT "lms_announcements_courseId_fkey";

-- DropForeignKey
ALTER TABLE "lms_announcements" DROP CONSTRAINT "lms_announcements_createdBy_fkey";

-- DropForeignKey
ALTER TABLE "lms_announcements" DROP CONSTRAINT "lms_announcements_orgId_fkey";

-- DropForeignKey
ALTER TABLE "lms_bookmarks" DROP CONSTRAINT "lms_bookmarks_studentId_fkey";

-- DropForeignKey
ALTER TABLE "lms_bookmarks" DROP CONSTRAINT "lms_bookmarks_topicId_fkey";

-- DropForeignKey
ALTER TABLE "lms_questions" DROP CONSTRAINT "lms_questions_moduleId_fkey";

-- DropForeignKey
ALTER TABLE "lms_quiz_attempts" DROP CONSTRAINT "lms_quiz_attempts_moduleId_fkey";

-- DropForeignKey
ALTER TABLE "lms_quiz_attempts" DROP CONSTRAINT "lms_quiz_attempts_studentId_fkey";

-- DropForeignKey
ALTER TABLE "lms_quiz_attempts" DROP CONSTRAINT "lms_quiz_attempts_userId_fkey";

-- DropIndex
DROP INDEX "internal_events_processedAt_idx";

-- DropIndex
DROP INDEX "whatsapp_conversations_leadId_idx";

-- AlterTable
ALTER TABLE "admissions" ADD COLUMN     "batchId" UUID,
ADD COLUMN     "courseId" UUID;

-- AlterTable
ALTER TABLE "fee_plan_items" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "fee_plans" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "lms_announcements" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "lms_assignment_submissions" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "lms_assignments" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "lms_batch_students" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "lms_batch_teachers" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "lms_batches" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "lms_bookmarks" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "lms_questions" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "lms_quiz_attempts" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "lms_timetable_slots" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "updatedAt" DROP DEFAULT;

-- CreateIndex
CREATE INDEX "admissions_courseId_idx" ON "admissions"("courseId");

-- CreateIndex
CREATE INDEX "admissions_batchId_idx" ON "admissions"("batchId");

-- AddForeignKey
ALTER TABLE "admissions" ADD CONSTRAINT "admissions_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "courses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admissions" ADD CONSTRAINT "admissions_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "lms_batches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lms_questions" ADD CONSTRAINT "lms_questions_moduleId_fkey" FOREIGN KEY ("moduleId") REFERENCES "lms_modules"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lms_quiz_attempts" ADD CONSTRAINT "lms_quiz_attempts_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lms_quiz_attempts" ADD CONSTRAINT "lms_quiz_attempts_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lms_quiz_attempts" ADD CONSTRAINT "lms_quiz_attempts_moduleId_fkey" FOREIGN KEY ("moduleId") REFERENCES "lms_modules"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lms_bookmarks" ADD CONSTRAINT "lms_bookmarks_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lms_bookmarks" ADD CONSTRAINT "lms_bookmarks_topicId_fkey" FOREIGN KEY ("topicId") REFERENCES "lms_topics"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lms_announcements" ADD CONSTRAINT "lms_announcements_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lms_announcements" ADD CONSTRAINT "lms_announcements_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "lms_courses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lms_announcements" ADD CONSTRAINT "lms_announcements_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- RenameIndex
ALTER INDEX "interakt_lead_syncs_org_event_sent_idx" RENAME TO "interakt_lead_syncs_orgId_eventName_eventSent_idx";

-- RenameIndex
ALTER INDEX "interakt_lead_syncs_org_status_updated_idx" RENAME TO "interakt_lead_syncs_orgId_status_updatedAt_idx";

-- RenameIndex
ALTER INDEX "internal_events_pending_idx" RENAME TO "internal_events_processedAt_failedAt_nextAttemptAt_idx";

-- RenameIndex
ALTER INDEX "whatsapp_conversations_orgId_lastMessageAt_desc_idx" RENAME TO "whatsapp_conversations_orgId_lastMessageAt_idx";

-- RenameIndex
ALTER INDEX "whatsapp_messages_orgId_createdAt_desc_idx" RENAME TO "whatsapp_messages_orgId_createdAt_idx";

-- RenameIndex
ALTER INDEX "whatsapp_provider_events_orgId_createdAt_desc_idx" RENAME TO "whatsapp_provider_events_orgId_createdAt_idx";

-- RenameIndex
ALTER INDEX "workflow_runs_execution_lease_idx" RENAME TO "workflow_runs_status_executionLeaseUntil_idx";
