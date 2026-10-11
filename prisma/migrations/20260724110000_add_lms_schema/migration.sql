-- CreateEnum
CREATE TYPE "LmsContentType" AS ENUM ('PDF', 'VIDEO');

-- CreateEnum
CREATE TYPE "LmsTestStatus" AS ENUM ('PASS', 'FAIL', 'PENDING');

-- CreateEnum
CREATE TYPE "LmsEnrollmentStatus" AS ENUM ('ACTIVE', 'COMPLETED', 'SUSPENDED', 'DROPPED');

-- CreateEnum
CREATE TYPE "LmsAttendanceStatus" AS ENUM ('PRESENT', 'ABSENT', 'LATE', 'EXCUSED');

-- CreateEnum
CREATE TYPE "LmsCertificateStatus" AS ENUM ('DRAFT', 'ISSUED', 'REVOKED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "UserRole" ADD VALUE 'TEACHER';
ALTER TYPE "UserRole" ADD VALUE 'STUDENT';

-- AlterTable
ALTER TABLE "students" ADD COLUMN     "userId" UUID;

-- CreateTable
CREATE TABLE "lms_courses" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "marketingCourseId" UUID,
    "slug" VARCHAR(255) NOT NULL,
    "title" VARCHAR(255) NOT NULL,
    "description" TEXT,
    "status" "ContentStatus" NOT NULL DEFAULT 'DRAFT',
    "isPublished" BOOLEAN NOT NULL DEFAULT false,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lms_courses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lms_course_teachers" (
    "id" UUID NOT NULL,
    "teacherId" UUID NOT NULL,
    "courseId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lms_course_teachers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lms_stages" (
    "id" UUID NOT NULL,
    "title" VARCHAR(255) NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "courseId" UUID NOT NULL,

    CONSTRAINT "lms_stages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lms_modules" (
    "id" UUID NOT NULL,
    "title" VARCHAR(255) NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "stageId" UUID NOT NULL,
    "unlockRules" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "lms_modules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lms_chapters" (
    "id" UUID NOT NULL,
    "title" VARCHAR(255) NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "moduleId" UUID NOT NULL,

    CONSTRAINT "lms_chapters_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lms_topics" (
    "id" UUID NOT NULL,
    "title" VARCHAR(255) NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "chapterId" UUID NOT NULL,

    CONSTRAINT "lms_topics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lms_contents" (
    "id" UUID NOT NULL,
    "title" VARCHAR(255) NOT NULL,
    "type" "LmsContentType" NOT NULL,
    "url" TEXT NOT NULL,
    "duration" INTEGER,
    "order" INTEGER NOT NULL DEFAULT 0,
    "topicId" UUID NOT NULL,
    "metadata" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "lms_contents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lms_enrollments" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "studentId" UUID NOT NULL,
    "courseId" UUID NOT NULL,
    "status" "LmsEnrollmentStatus" NOT NULL DEFAULT 'ACTIVE',
    "enrolledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "metadata" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "lms_enrollments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lms_student_progress" (
    "id" UUID NOT NULL,
    "studentId" UUID NOT NULL,
    "userId" UUID,
    "topicId" UUID NOT NULL,
    "completed" BOOLEAN NOT NULL DEFAULT false,
    "percent" INTEGER NOT NULL DEFAULT 0,
    "completedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lms_student_progress_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lms_assessments" (
    "id" UUID NOT NULL,
    "studentId" UUID NOT NULL,
    "userId" UUID,
    "moduleId" UUID NOT NULL,
    "score" INTEGER NOT NULL DEFAULT 0,
    "status" "LmsTestStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 1,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lms_assessments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lms_attendance_sessions" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "courseId" UUID NOT NULL,
    "title" VARCHAR(255) NOT NULL,
    "heldAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lms_attendance_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lms_attendance_records" (
    "id" UUID NOT NULL,
    "sessionId" UUID NOT NULL,
    "studentId" UUID NOT NULL,
    "status" "LmsAttendanceStatus" NOT NULL DEFAULT 'PRESENT',
    "markedBy" UUID,
    "markedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "smsSentAt" TIMESTAMP(3),
    "notes" TEXT,

    CONSTRAINT "lms_attendance_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lms_certificates" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "studentId" UUID NOT NULL,
    "courseId" UUID NOT NULL,
    "certificateNo" VARCHAR(100) NOT NULL,
    "title" VARCHAR(255) NOT NULL,
    "status" "LmsCertificateStatus" NOT NULL DEFAULT 'DRAFT',
    "issuedAt" TIMESTAMP(3),
    "issuedBy" UUID,
    "fileUrl" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lms_certificates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lms_chat_rooms" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "courseId" UUID NOT NULL,
    "title" VARCHAR(255),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lms_chat_rooms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lms_messages" (
    "id" UUID NOT NULL,
    "roomId" UUID NOT NULL,
    "senderId" UUID NOT NULL,
    "text" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lms_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lms_notifications" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "title" VARCHAR(255) NOT NULL,
    "body" TEXT NOT NULL,
    "isRead" BOOLEAN NOT NULL DEFAULT false,
    "linkUrl" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lms_notifications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "lms_courses_orgId_status_idx" ON "lms_courses"("orgId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "lms_courses_orgId_slug_key" ON "lms_courses"("orgId", "slug");

-- CreateIndex
CREATE INDEX "lms_course_teachers_courseId_idx" ON "lms_course_teachers"("courseId");

-- CreateIndex
CREATE UNIQUE INDEX "lms_course_teachers_teacherId_courseId_key" ON "lms_course_teachers"("teacherId", "courseId");

-- CreateIndex
CREATE INDEX "lms_stages_courseId_order_idx" ON "lms_stages"("courseId", "order");

-- CreateIndex
CREATE INDEX "lms_modules_stageId_order_idx" ON "lms_modules"("stageId", "order");

-- CreateIndex
CREATE INDEX "lms_chapters_moduleId_order_idx" ON "lms_chapters"("moduleId", "order");

-- CreateIndex
CREATE INDEX "lms_topics_chapterId_order_idx" ON "lms_topics"("chapterId", "order");

-- CreateIndex
CREATE INDEX "lms_contents_topicId_order_idx" ON "lms_contents"("topicId", "order");

-- CreateIndex
CREATE INDEX "lms_enrollments_orgId_status_idx" ON "lms_enrollments"("orgId", "status");

-- CreateIndex
CREATE INDEX "lms_enrollments_courseId_idx" ON "lms_enrollments"("courseId");

-- CreateIndex
CREATE UNIQUE INDEX "lms_enrollments_studentId_courseId_key" ON "lms_enrollments"("studentId", "courseId");

-- CreateIndex
CREATE INDEX "lms_student_progress_topicId_idx" ON "lms_student_progress"("topicId");

-- CreateIndex
CREATE UNIQUE INDEX "lms_student_progress_studentId_topicId_key" ON "lms_student_progress"("studentId", "topicId");

-- CreateIndex
CREATE INDEX "lms_assessments_moduleId_status_idx" ON "lms_assessments"("moduleId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "lms_assessments_studentId_moduleId_key" ON "lms_assessments"("studentId", "moduleId");

-- CreateIndex
CREATE INDEX "lms_attendance_sessions_orgId_heldAt_idx" ON "lms_attendance_sessions"("orgId", "heldAt" DESC);

-- CreateIndex
CREATE INDEX "lms_attendance_sessions_courseId_idx" ON "lms_attendance_sessions"("courseId");

-- CreateIndex
CREATE INDEX "lms_attendance_records_studentId_idx" ON "lms_attendance_records"("studentId");

-- CreateIndex
CREATE UNIQUE INDEX "lms_attendance_records_sessionId_studentId_key" ON "lms_attendance_records"("sessionId", "studentId");

-- CreateIndex
CREATE INDEX "lms_certificates_studentId_idx" ON "lms_certificates"("studentId");

-- CreateIndex
CREATE INDEX "lms_certificates_courseId_idx" ON "lms_certificates"("courseId");

-- CreateIndex
CREATE UNIQUE INDEX "lms_certificates_orgId_certificateNo_key" ON "lms_certificates"("orgId", "certificateNo");

-- CreateIndex
CREATE INDEX "lms_chat_rooms_orgId_courseId_idx" ON "lms_chat_rooms"("orgId", "courseId");

-- CreateIndex
CREATE INDEX "lms_messages_roomId_createdAt_idx" ON "lms_messages"("roomId", "createdAt");

-- CreateIndex
CREATE INDEX "lms_notifications_userId_isRead_createdAt_idx" ON "lms_notifications"("userId", "isRead", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "lms_notifications_orgId_createdAt_idx" ON "lms_notifications"("orgId", "createdAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "students_userId_key" ON "students"("userId");

-- AddForeignKey
ALTER TABLE "students" ADD CONSTRAINT "students_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lms_courses" ADD CONSTRAINT "lms_courses_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lms_course_teachers" ADD CONSTRAINT "lms_course_teachers_teacherId_fkey" FOREIGN KEY ("teacherId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lms_course_teachers" ADD CONSTRAINT "lms_course_teachers_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "lms_courses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lms_stages" ADD CONSTRAINT "lms_stages_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "lms_courses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lms_modules" ADD CONSTRAINT "lms_modules_stageId_fkey" FOREIGN KEY ("stageId") REFERENCES "lms_stages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lms_chapters" ADD CONSTRAINT "lms_chapters_moduleId_fkey" FOREIGN KEY ("moduleId") REFERENCES "lms_modules"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lms_topics" ADD CONSTRAINT "lms_topics_chapterId_fkey" FOREIGN KEY ("chapterId") REFERENCES "lms_chapters"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lms_contents" ADD CONSTRAINT "lms_contents_topicId_fkey" FOREIGN KEY ("topicId") REFERENCES "lms_topics"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lms_enrollments" ADD CONSTRAINT "lms_enrollments_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lms_enrollments" ADD CONSTRAINT "lms_enrollments_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lms_enrollments" ADD CONSTRAINT "lms_enrollments_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "lms_courses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lms_student_progress" ADD CONSTRAINT "lms_student_progress_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lms_student_progress" ADD CONSTRAINT "lms_student_progress_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lms_student_progress" ADD CONSTRAINT "lms_student_progress_topicId_fkey" FOREIGN KEY ("topicId") REFERENCES "lms_topics"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lms_assessments" ADD CONSTRAINT "lms_assessments_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lms_assessments" ADD CONSTRAINT "lms_assessments_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lms_assessments" ADD CONSTRAINT "lms_assessments_moduleId_fkey" FOREIGN KEY ("moduleId") REFERENCES "lms_modules"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lms_attendance_sessions" ADD CONSTRAINT "lms_attendance_sessions_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lms_attendance_sessions" ADD CONSTRAINT "lms_attendance_sessions_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "lms_courses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lms_attendance_records" ADD CONSTRAINT "lms_attendance_records_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "lms_attendance_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lms_attendance_records" ADD CONSTRAINT "lms_attendance_records_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lms_attendance_records" ADD CONSTRAINT "lms_attendance_records_markedBy_fkey" FOREIGN KEY ("markedBy") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lms_certificates" ADD CONSTRAINT "lms_certificates_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lms_certificates" ADD CONSTRAINT "lms_certificates_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lms_certificates" ADD CONSTRAINT "lms_certificates_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "lms_courses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lms_certificates" ADD CONSTRAINT "lms_certificates_issuedBy_fkey" FOREIGN KEY ("issuedBy") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lms_chat_rooms" ADD CONSTRAINT "lms_chat_rooms_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lms_chat_rooms" ADD CONSTRAINT "lms_chat_rooms_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "lms_courses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lms_messages" ADD CONSTRAINT "lms_messages_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "lms_chat_rooms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lms_messages" ADD CONSTRAINT "lms_messages_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lms_notifications" ADD CONSTRAINT "lms_notifications_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lms_notifications" ADD CONSTRAINT "lms_notifications_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

