-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "public"."ActivityType" AS ENUM ('CALL', 'EMAIL', 'WHATSAPP', 'SMS', 'NOTE', 'MEETING', 'TASK', 'STATUS_CHANGE', 'ASSIGNMENT', 'SYSTEM');

-- CreateEnum
CREATE TYPE "public"."AdmissionStage" AS ENUM ('ENQUIRY', 'DOCUMENT_COLLECTION', 'VERIFICATION', 'OFFER_LETTER', 'FEE_PAYMENT', 'ENROLLED', 'DROPPED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "public"."ContentStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'SCHEDULED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "public"."DocumentStatus" AS ENUM ('PENDING', 'UPLOADED', 'UNDER_REVIEW', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "public"."DocumentType" AS ENUM ('AADHAR_CARD', 'PAN_CARD', 'PASSPORT', 'PHOTO', 'CLASS_10_MARKSHEET', 'CLASS_12_MARKSHEET', 'MEDICAL_CERTIFICATE', 'BIRTH_CERTIFICATE', 'BANK_STATEMENT', 'OTHER');

-- CreateEnum
CREATE TYPE "public"."JobApplicationStatus" AS ENUM ('SUBMITTED', 'UNDER_REVIEW', 'SHORTLISTED', 'INTERVIEW_SCHEDULED', 'SELECTED', 'REJECTED', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "public"."JobStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'CLOSED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "public"."LeadSource" AS ENUM ('HOMEPAGE_CTA', 'COURSE_PAGE', 'CONTACT_FORM', 'CALLBACK_REQUEST', 'BROCHURE_DOWNLOAD', 'GOOGLE_ADS', 'FACEBOOK_ADS', 'ORGANIC', 'REFERRAL', 'WHATSAPP', 'DIRECT');

-- CreateEnum
CREATE TYPE "public"."LeadStatus" AS ENUM ('NEW', 'CONTACTED', 'INTERESTED', 'FOLLOW_UP', 'COUNSELED', 'APPLICATION_SUBMITTED', 'CONVERTED', 'LOST');

-- CreateEnum
CREATE TYPE "public"."NotificationChannel" AS ENUM ('EMAIL', 'SMS', 'WHATSAPP', 'IN_APP');

-- CreateEnum
CREATE TYPE "public"."NotificationEvent" AS ENUM ('NEW_LEAD', 'LEAD_ASSIGNED', 'LEAD_STATUS_CHANGED', 'ADMISSION_STAGE_CHANGED', 'JOB_PUBLISHED', 'TESTIMONIAL_SUBMITTED', 'PAYMENT_RECEIVED', 'PLACEMENT_ADDED', 'ENQUIRY_RECEIVED', 'USER_INVITED', 'TASK_DUE', 'WORKFLOW_TRIGGERED');

-- CreateEnum
CREATE TYPE "public"."OrgPlan" AS ENUM ('STARTER', 'PROFESSIONAL', 'ENTERPRISE');

-- CreateEnum
CREATE TYPE "public"."PaymentMethod" AS ENUM ('CASH', 'BANK_TRANSFER', 'UPI', 'CARD', 'CHEQUE', 'DD', 'ONLINE');

-- CreateEnum
CREATE TYPE "public"."PaymentStatus" AS ENUM ('PENDING', 'COMPLETED', 'FAILED', 'REFUNDED', 'PARTIALLY_REFUNDED');

-- CreateEnum
CREATE TYPE "public"."PlacementStatus" AS ENUM ('PENDING', 'CONFIRMED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "public"."ResourceType" AS ENUM ('PDF', 'VIDEO', 'LINK', 'IMAGE', 'DOCUMENT', 'AUDIO', 'OTHER');

-- CreateEnum
CREATE TYPE "public"."StudentStatus" AS ENUM ('ACTIVE', 'GRADUATED', 'DROPPED', 'SUSPENDED', 'ON_HOLD');

-- CreateEnum
CREATE TYPE "public"."TestimonialStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "public"."UserRole" AS ENUM ('SUPER_ADMIN', 'ADMIN', 'MARKETING_MANAGER', 'CONTENT_MANAGER', 'ADMISSIONS_COUNSELOR', 'PLACEMENT_MANAGER', 'SUPPORT_STAFF');

-- CreateEnum
CREATE TYPE "public"."WorkflowTrigger" AS ENUM ('LEAD_CREATED', 'LEAD_STATUS_CHANGED', 'LEAD_ASSIGNED', 'ADMISSION_STAGE_CHANGED', 'PAYMENT_RECEIVED', 'FORM_SUBMITTED', 'SCHEDULED');

-- CreateTable
CREATE TABLE "public"."accounts" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerAccountId" TEXT NOT NULL,
    "refresh_token" TEXT,
    "access_token" TEXT,
    "expires_at" INTEGER,
    "token_type" TEXT,
    "scope" TEXT,
    "id_token" TEXT,
    "session_state" TEXT,

    CONSTRAINT "accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."activity_feed_items" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "actorId" UUID,
    "verb" VARCHAR(100) NOT NULL,
    "objectType" VARCHAR(100) NOT NULL,
    "objectId" VARCHAR(255) NOT NULL,
    "objectSnapshot" JSONB NOT NULL,
    "targetId" VARCHAR(255),
    "targetType" VARCHAR(100),
    "context" JSONB NOT NULL DEFAULT '{}',
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "activity_feed_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."admission_stage_logs" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "admissionId" UUID NOT NULL,
    "fromStage" "public"."AdmissionStage",
    "toStage" "public"."AdmissionStage" NOT NULL,
    "notes" TEXT,
    "changedBy" UUID,
    "changedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admission_stage_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."admissions" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "campusId" UUID,
    "studentId" UUID,
    "leadId" UUID NOT NULL,
    "applicationNo" VARCHAR(50) NOT NULL,
    "stage" "public"."AdmissionStage" NOT NULL DEFAULT 'ENQUIRY',
    "courseName" VARCHAR(255),
    "batchName" VARCHAR(255),
    "batchStartDate" TIMESTAMP(3),
    "feeAmount" DECIMAL(10,2),
    "feeDiscount" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "feeFinal" DECIMAL(10,2),
    "feePaid" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "feeBalance" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "counselorId" UUID,
    "stageChangedAt" TIMESTAMP(3),
    "stageChangedBy" UUID,
    "notes" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "admissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."audit_logs" (
    "id" BIGSERIAL NOT NULL,
    "orgId" UUID NOT NULL,
    "userId" UUID,
    "sessionId" UUID,
    "requestId" UUID,
    "action" VARCHAR(100) NOT NULL,
    "entityType" VARCHAR(100) NOT NULL,
    "entityId" VARCHAR(255),
    "oldValue" JSONB,
    "newValue" JSONB,
    "diff" JSONB,
    "ipAddress" VARCHAR(45),
    "userAgent" TEXT,
    "prevHash" VARCHAR(64),
    "rowHash" VARCHAR(64),
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."campuses" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "code" VARCHAR(20) NOT NULL,
    "city" VARCHAR(100) NOT NULL,
    "state" VARCHAR(100) NOT NULL,
    "country" VARCHAR(2) NOT NULL DEFAULT 'IN',
    "address" TEXT,
    "phone" VARCHAR(20),
    "email" VARCHAR(255),
    "headCounselorId" UUID,
    "timezone" VARCHAR(50) NOT NULL DEFAULT 'Asia/Kolkata',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "campuses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."content_blocks" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "type" VARCHAR(100) NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "description" TEXT,
    "schema" JSONB NOT NULL,
    "defaultProps" JSONB NOT NULL DEFAULT '{}',
    "category" VARCHAR(100),
    "isGlobal" BOOLEAN NOT NULL DEFAULT false,
    "createdBy" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "content_blocks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."course_versions" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "courseId" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "snapshot" JSONB NOT NULL,
    "status" "public"."ContentStatus" NOT NULL,
    "notes" TEXT,
    "createdBy" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "course_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."courses" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "slug" VARCHAR(255) NOT NULL,
    "title" VARCHAR(255) NOT NULL,
    "subtitle" VARCHAR(500),
    "description" TEXT,
    "status" "public"."ContentStatus" NOT NULL DEFAULT 'DRAFT',
    "category" VARCHAR(100),
    "duration" VARCHAR(100),
    "eligibility" TEXT,
    "curriculum" JSONB NOT NULL DEFAULT '[]',
    "fee" DECIMAL(10,2),
    "bannerImageId" UUID,
    "galleryIds" TEXT[],
    "seoTitle" VARCHAR(255),
    "seoDesc" VARCHAR(500),
    "seoKeywords" TEXT[],
    "order" INTEGER NOT NULL DEFAULT 0,
    "isFeatured" BOOLEAN NOT NULL DEFAULT false,
    "publishedAt" TIMESTAMP(3),
    "scheduledAt" TIMESTAMP(3),
    "publishedBy" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdBy" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "courses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."documents" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "studentId" UUID,
    "admissionId" UUID,
    "uploadedBy" UUID,
    "reviewedBy" UUID,
    "documentType" "public"."DocumentType" NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "fileUrl" TEXT NOT NULL,
    "fileKey" VARCHAR(500) NOT NULL,
    "fileMimeType" VARCHAR(100),
    "fileSizeBytes" INTEGER,
    "status" "public"."DocumentStatus" NOT NULL DEFAULT 'UPLOADED',
    "reviewedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "expiresAt" TIMESTAMP(3),
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."event_log" (
    "id" BIGSERIAL NOT NULL,
    "orgId" UUID NOT NULL,
    "eventName" VARCHAR(255) NOT NULL,
    "actorId" UUID,
    "actorType" VARCHAR(50),
    "entityType" VARCHAR(100),
    "entityId" VARCHAR(255),
    "payload" JSONB NOT NULL DEFAULT '{}',
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "event_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."fallback_leads" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "email" TEXT,
    "pincode" TEXT,
    "course" TEXT,
    "source" TEXT,
    "retry_count" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'pending',

    CONSTRAINT "fallback_leads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."feature_flags" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "key" VARCHAR(100) NOT NULL,
    "value" JSONB NOT NULL,
    "description" TEXT,
    "isEnabled" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "feature_flags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."hiring_partners" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "slug" VARCHAR(255) NOT NULL,
    "logoId" UUID,
    "website" VARCHAR(500),
    "industry" VARCHAR(100),
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdBy" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hiring_partners_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."job_applications" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "jobId" UUID NOT NULL,
    "studentId" UUID,
    "applicantName" VARCHAR(255) NOT NULL,
    "applicantEmail" VARCHAR(255) NOT NULL,
    "applicantPhone" VARCHAR(20),
    "resumeUrl" TEXT,
    "coverLetter" TEXT,
    "status" "public"."JobApplicationStatus" NOT NULL DEFAULT 'SUBMITTED',
    "reviewedBy" UUID,
    "reviewedAt" TIMESTAMP(3),
    "reviewNotes" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "job_applications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."jobs" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "hiringPartnerId" UUID,
    "title" VARCHAR(255) NOT NULL,
    "slug" VARCHAR(255) NOT NULL,
    "description" TEXT,
    "requirements" TEXT,
    "location" VARCHAR(255),
    "isRemote" BOOLEAN NOT NULL DEFAULT false,
    "jobType" VARCHAR(50) NOT NULL DEFAULT 'full_time',
    "salaryMin" DECIMAL(12,2),
    "salaryMax" DECIMAL(12,2),
    "currency" VARCHAR(3) NOT NULL DEFAULT 'INR',
    "experienceYears" INTEGER,
    "status" "public"."JobStatus" NOT NULL DEFAULT 'DRAFT',
    "publishedAt" TIMESTAMP(3),
    "closesAt" TIMESTAMP(3),
    "tags" TEXT[],
    "courseIds" TEXT[],
    "seoTitle" VARCHAR(255),
    "seoDesc" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "publishedBy" UUID,
    "createdBy" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."lead_activities" (
    "id" UUID NOT NULL,
    "leadId" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "performedBy" UUID,
    "activityType" "public"."ActivityType" NOT NULL,
    "title" VARCHAR(500),
    "notes" TEXT,
    "outcome" VARCHAR(255),
    "nextAction" TEXT,
    "dueAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "durationMins" INTEGER,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lead_activities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."lead_score_history" (
    "id" UUID NOT NULL,
    "leadId" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "score" INTEGER NOT NULL,
    "reason" VARCHAR(255),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lead_score_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."leads" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "campusId" UUID,
    "name" VARCHAR(255) NOT NULL,
    "email" VARCHAR(255),
    "phone" VARCHAR(20) NOT NULL,
    "city" VARCHAR(100),
    "state" VARCHAR(100),
    "courseInterest" VARCHAR(255),
    "source" "public"."LeadSource" NOT NULL DEFAULT 'DIRECT',
    "status" "public"."LeadStatus" NOT NULL DEFAULT 'NEW',
    "assignedTo" UUID,
    "createdBy" UUID,
    "utmSource" VARCHAR(255),
    "utmMedium" VARCHAR(255),
    "utmCampaign" VARCHAR(255),
    "utmTerm" VARCHAR(255),
    "utmContent" VARCHAR(255),
    "referrerUrl" TEXT,
    "landingPage" TEXT,
    "score" INTEGER NOT NULL DEFAULT 0,
    "tags" TEXT[],
    "customFields" JSONB NOT NULL DEFAULT '{}',
    "isDuplicate" BOOLEAN NOT NULL DEFAULT false,
    "duplicateOf" UUID,
    "convertedAt" TIMESTAMP(3),
    "lostReason" TEXT,
    "nextFollowUp" TIMESTAMP(3),
    "lastActivityAt" TIMESTAMP(3),
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "leads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."media_assets" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "folderId" UUID,
    "uploadedBy" UUID,
    "name" VARCHAR(255) NOT NULL,
    "originalName" VARCHAR(255) NOT NULL,
    "fileKey" VARCHAR(500) NOT NULL,
    "fileUrl" TEXT NOT NULL,
    "mimeType" VARCHAR(100) NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "duration" INTEGER,
    "altText" VARCHAR(500),
    "caption" TEXT,
    "tags" TEXT[],
    "usageCount" INTEGER NOT NULL DEFAULT 0,
    "replacedById" UUID,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "media_assets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."media_folders" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "parentId" UUID,
    "name" VARCHAR(255) NOT NULL,
    "slug" VARCHAR(255) NOT NULL,
    "path" TEXT NOT NULL,
    "createdBy" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "media_folders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."media_usages" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "assetId" UUID NOT NULL,
    "entityType" VARCHAR(100) NOT NULL,
    "entityId" VARCHAR(255) NOT NULL,
    "fieldName" VARCHAR(100),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "media_usages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."nav_menus" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "location" VARCHAR(100) NOT NULL,
    "items" JSONB NOT NULL DEFAULT '[]',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdBy" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "nav_menus_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."notification_logs" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "templateId" UUID,
    "event" "public"."NotificationEvent",
    "channel" "public"."NotificationChannel" NOT NULL,
    "recipient" VARCHAR(255) NOT NULL,
    "subject" TEXT,
    "body" TEXT,
    "status" VARCHAR(30) NOT NULL DEFAULT 'PENDING',
    "errorMsg" TEXT,
    "externalId" VARCHAR(255),
    "entityType" VARCHAR(100),
    "entityId" VARCHAR(255),
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notification_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."notification_templates" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "event" "public"."NotificationEvent" NOT NULL,
    "channel" "public"."NotificationChannel" NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "subject" VARCHAR(500),
    "body" TEXT NOT NULL,
    "variables" TEXT[],
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notification_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."organizations" (
    "id" UUID NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "slug" VARCHAR(100) NOT NULL,
    "domain" VARCHAR(255),
    "plan" "public"."OrgPlan" NOT NULL DEFAULT 'STARTER',
    "planExpiresAt" TIMESTAMP(3),
    "logoUrl" TEXT,
    "settings" JSONB NOT NULL DEFAULT '{}',
    "featureFlags" JSONB NOT NULL DEFAULT '{}',
    "parentOrgId" UUID,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "organizations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."page_blocks" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "sectionId" UUID NOT NULL,
    "blockTypeId" UUID NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "props" JSONB NOT NULL DEFAULT '{}',
    "isVisible" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "page_blocks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."page_sections" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "pageId" UUID NOT NULL,
    "name" VARCHAR(255),
    "order" INTEGER NOT NULL DEFAULT 0,
    "isVisible" BOOLEAN NOT NULL DEFAULT true,
    "settings" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "page_sections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."page_versions" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "pageId" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "title" VARCHAR(255) NOT NULL,
    "snapshot" JSONB NOT NULL,
    "status" "public"."ContentStatus" NOT NULL,
    "publishedAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdBy" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "page_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."pages" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "title" VARCHAR(255) NOT NULL,
    "slug" VARCHAR(255) NOT NULL,
    "description" TEXT,
    "status" "public"."ContentStatus" NOT NULL DEFAULT 'DRAFT',
    "publishedAt" TIMESTAMP(3),
    "scheduledAt" TIMESTAMP(3),
    "publishedBy" UUID,
    "seoTitle" VARCHAR(255),
    "seoDesc" VARCHAR(500),
    "seoKeywords" TEXT[],
    "ogImage" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdBy" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."payment_transactions" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "campusId" UUID,
    "admissionId" UUID NOT NULL,
    "studentId" UUID,
    "amount" DECIMAL(10,2) NOT NULL,
    "currency" VARCHAR(3) NOT NULL DEFAULT 'INR',
    "method" "public"."PaymentMethod" NOT NULL,
    "status" "public"."PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "referenceNo" VARCHAR(255),
    "receiptNo" VARCHAR(100),
    "feeType" VARCHAR(100),
    "description" TEXT,
    "paidAt" TIMESTAMP(3),
    "gateway" VARCHAR(100),
    "gatewayTxnId" VARCHAR(255),
    "gatewayResponse" JSONB,
    "notes" TEXT,
    "collectedBy" UUID,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payment_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."permissions" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "role" "public"."UserRole" NOT NULL,
    "resource" VARCHAR(100) NOT NULL,
    "action" VARCHAR(50) NOT NULL,
    "conditions" JSONB,
    "campusScope" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."placements" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "studentId" UUID NOT NULL,
    "hiringPartnerId" UUID,
    "jobTitle" VARCHAR(255) NOT NULL,
    "package" DECIMAL(12,2),
    "currency" VARCHAR(3) NOT NULL DEFAULT 'INR',
    "joiningDate" TIMESTAMP(3),
    "status" "public"."PlacementStatus" NOT NULL DEFAULT 'PENDING',
    "isPublic" BOOLEAN NOT NULL DEFAULT false,
    "batchYear" INTEGER,
    "notes" TEXT,
    "createdBy" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "placements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."resources" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "title" VARCHAR(255) NOT NULL,
    "slug" VARCHAR(255) NOT NULL,
    "description" TEXT,
    "type" "public"."ResourceType" NOT NULL,
    "status" "public"."ContentStatus" NOT NULL DEFAULT 'DRAFT',
    "fileUrl" TEXT,
    "externalUrl" TEXT,
    "thumbnailId" UUID,
    "tags" TEXT[],
    "category" VARCHAR(100),
    "isGated" BOOLEAN NOT NULL DEFAULT false,
    "downloadCount" INTEGER NOT NULL DEFAULT 0,
    "seoTitle" VARCHAR(255),
    "seoDesc" TEXT,
    "publishedAt" TIMESTAMP(3),
    "scheduledAt" TIMESTAMP(3),
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdBy" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "resources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."sessions" (
    "id" UUID NOT NULL,
    "sessionToken" TEXT NOT NULL,
    "userId" UUID NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL,
    "ipAddress" VARCHAR(45),
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."students" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "campusId" UUID,
    "leadId" UUID,
    "studentCode" VARCHAR(50) NOT NULL,
    "firstName" VARCHAR(100) NOT NULL,
    "lastName" VARCHAR(100) NOT NULL,
    "email" VARCHAR(255) NOT NULL,
    "phone" VARCHAR(20) NOT NULL,
    "dateOfBirth" TIMESTAMP(3),
    "gender" VARCHAR(20),
    "nationality" VARCHAR(100) NOT NULL DEFAULT 'Indian',
    "address" JSONB NOT NULL DEFAULT '{}',
    "guardianName" VARCHAR(255),
    "guardianPhone" VARCHAR(20),
    "guardianEmail" VARCHAR(255),
    "medicalFitness" BOOLEAN NOT NULL DEFAULT false,
    "class10Board" VARCHAR(100),
    "class10Year" INTEGER,
    "class10Percent" DOUBLE PRECISION,
    "class12Board" VARCHAR(100),
    "class12Year" INTEGER,
    "class12Percent" DOUBLE PRECISION,
    "class12Stream" VARCHAR(100),
    "status" "public"."StudentStatus" NOT NULL DEFAULT 'ACTIVE',
    "enrolledAt" TIMESTAMP(3),
    "graduatedAt" TIMESTAMP(3),
    "droppedAt" TIMESTAMP(3),
    "customFields" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "students_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."testimonials" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "studentId" UUID,
    "authorName" VARCHAR(255) NOT NULL,
    "authorTitle" VARCHAR(255),
    "authorEmail" VARCHAR(255),
    "content" TEXT NOT NULL,
    "rating" INTEGER,
    "avatarId" UUID,
    "courseId" UUID,
    "batchYear" INTEGER,
    "status" "public"."TestimonialStatus" NOT NULL DEFAULT 'PENDING',
    "isFeatured" BOOLEAN NOT NULL DEFAULT false,
    "order" INTEGER NOT NULL DEFAULT 0,
    "reviewedBy" UUID,
    "reviewedAt" TIMESTAMP(3),
    "reviewNotes" TEXT,
    "source" VARCHAR(100),
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "testimonials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."users" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "campusId" UUID,
    "name" VARCHAR(255) NOT NULL,
    "email" VARCHAR(255) NOT NULL,
    "phone" VARCHAR(20),
    "passwordHash" TEXT,
    "role" "public"."UserRole" NOT NULL DEFAULT 'SUPPORT_STAFF',
    "avatarUrl" TEXT,
    "emailVerified" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isMfaEnabled" BOOLEAN NOT NULL DEFAULT false,
    "mfaSecret" TEXT,
    "lastLoginAt" TIMESTAMP(3),
    "lastLoginIp" VARCHAR(45),
    "invitedBy" UUID,
    "inviteToken" TEXT,
    "inviteExpiry" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."verification_tokens" (
    "identifier" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL
);

-- CreateTable
CREATE TABLE "public"."workflow_runs" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "workflowId" UUID NOT NULL,
    "entityType" VARCHAR(100) NOT NULL,
    "entityId" VARCHAR(255) NOT NULL,
    "triggeredBy" UUID,
    "currentStep" INTEGER NOT NULL DEFAULT 0,
    "status" VARCHAR(30) NOT NULL DEFAULT 'RUNNING',
    "context" JSONB NOT NULL DEFAULT '{}',
    "error" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "workflow_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."workflows" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "description" TEXT,
    "triggerEvent" "public"."WorkflowTrigger" NOT NULL,
    "triggerConditions" JSONB NOT NULL DEFAULT '{}',
    "steps" JSONB NOT NULL DEFAULT '[]',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workflows_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "accounts_provider_providerAccountId_key" ON "public"."accounts"("provider" ASC, "providerAccountId" ASC);

-- CreateIndex
CREATE INDEX "activity_feed_items_actorId_occurredAt_idx" ON "public"."activity_feed_items"("actorId" ASC, "occurredAt" DESC);

-- CreateIndex
CREATE INDEX "activity_feed_items_objectType_objectId_idx" ON "public"."activity_feed_items"("objectType" ASC, "objectId" ASC);

-- CreateIndex
CREATE INDEX "activity_feed_items_orgId_occurredAt_idx" ON "public"."activity_feed_items"("orgId" ASC, "occurredAt" DESC);

-- CreateIndex
CREATE INDEX "admission_stage_logs_admissionId_changedAt_idx" ON "public"."admission_stage_logs"("admissionId" ASC, "changedAt" DESC);

-- CreateIndex
CREATE INDEX "admission_stage_logs_orgId_idx" ON "public"."admission_stage_logs"("orgId" ASC);

-- CreateIndex
CREATE INDEX "admissions_counselorId_idx" ON "public"."admissions"("counselorId" ASC);

-- CreateIndex
CREATE INDEX "admissions_leadId_idx" ON "public"."admissions"("leadId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "admissions_orgId_applicationNo_key" ON "public"."admissions"("orgId" ASC, "applicationNo" ASC);

-- CreateIndex
CREATE INDEX "admissions_orgId_createdAt_idx" ON "public"."admissions"("orgId" ASC, "createdAt" DESC);

-- CreateIndex
CREATE INDEX "admissions_orgId_stage_idx" ON "public"."admissions"("orgId" ASC, "stage" ASC);

-- CreateIndex
CREATE INDEX "admissions_studentId_idx" ON "public"."admissions"("studentId" ASC);

-- CreateIndex
CREATE INDEX "audit_logs_entityType_entityId_idx" ON "public"."audit_logs"("entityType" ASC, "entityId" ASC);

-- CreateIndex
CREATE INDEX "audit_logs_orgId_occurredAt_idx" ON "public"."audit_logs"("orgId" ASC, "occurredAt" DESC);

-- CreateIndex
CREATE INDEX "audit_logs_userId_idx" ON "public"."audit_logs"("userId" ASC);

-- CreateIndex
CREATE INDEX "campuses_isActive_idx" ON "public"."campuses"("isActive" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "campuses_orgId_code_key" ON "public"."campuses"("orgId" ASC, "code" ASC);

-- CreateIndex
CREATE INDEX "campuses_orgId_idx" ON "public"."campuses"("orgId" ASC);

-- CreateIndex
CREATE INDEX "content_blocks_orgId_category_idx" ON "public"."content_blocks"("orgId" ASC, "category" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "content_blocks_orgId_type_key" ON "public"."content_blocks"("orgId" ASC, "type" ASC);

-- CreateIndex
CREATE INDEX "course_versions_courseId_createdAt_idx" ON "public"."course_versions"("courseId" ASC, "createdAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "course_versions_courseId_version_key" ON "public"."course_versions"("courseId" ASC, "version" ASC);

-- CreateIndex
CREATE INDEX "courses_orgId_isFeatured_idx" ON "public"."courses"("orgId" ASC, "isFeatured" ASC);

-- CreateIndex
CREATE INDEX "courses_orgId_order_idx" ON "public"."courses"("orgId" ASC, "order" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "courses_orgId_slug_key" ON "public"."courses"("orgId" ASC, "slug" ASC);

-- CreateIndex
CREATE INDEX "courses_orgId_status_idx" ON "public"."courses"("orgId" ASC, "status" ASC);

-- CreateIndex
CREATE INDEX "documents_admissionId_idx" ON "public"."documents"("admissionId" ASC);

-- CreateIndex
CREATE INDEX "documents_orgId_documentType_idx" ON "public"."documents"("orgId" ASC, "documentType" ASC);

-- CreateIndex
CREATE INDEX "documents_orgId_status_idx" ON "public"."documents"("orgId" ASC, "status" ASC);

-- CreateIndex
CREATE INDEX "documents_studentId_idx" ON "public"."documents"("studentId" ASC);

-- CreateIndex
CREATE INDEX "event_log_entityType_entityId_idx" ON "public"."event_log"("entityType" ASC, "entityId" ASC);

-- CreateIndex
CREATE INDEX "event_log_orgId_eventName_idx" ON "public"."event_log"("orgId" ASC, "eventName" ASC);

-- CreateIndex
CREATE INDEX "event_log_orgId_occurredAt_idx" ON "public"."event_log"("orgId" ASC, "occurredAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "feature_flags_orgId_key_key" ON "public"."feature_flags"("orgId" ASC, "key" ASC);

-- CreateIndex
CREATE INDEX "hiring_partners_orgId_isActive_idx" ON "public"."hiring_partners"("orgId" ASC, "isActive" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "hiring_partners_orgId_slug_key" ON "public"."hiring_partners"("orgId" ASC, "slug" ASC);

-- CreateIndex
CREATE INDEX "job_applications_orgId_jobId_idx" ON "public"."job_applications"("orgId" ASC, "jobId" ASC);

-- CreateIndex
CREATE INDEX "job_applications_orgId_status_idx" ON "public"."job_applications"("orgId" ASC, "status" ASC);

-- CreateIndex
CREATE INDEX "job_applications_orgId_studentId_idx" ON "public"."job_applications"("orgId" ASC, "studentId" ASC);

-- CreateIndex
CREATE INDEX "jobs_orgId_hiringPartnerId_idx" ON "public"."jobs"("orgId" ASC, "hiringPartnerId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "jobs_orgId_slug_key" ON "public"."jobs"("orgId" ASC, "slug" ASC);

-- CreateIndex
CREATE INDEX "jobs_orgId_status_idx" ON "public"."jobs"("orgId" ASC, "status" ASC);

-- CreateIndex
CREATE INDEX "lead_activities_dueAt_idx" ON "public"."lead_activities"("dueAt" ASC);

-- CreateIndex
CREATE INDEX "lead_activities_leadId_createdAt_idx" ON "public"."lead_activities"("leadId" ASC, "createdAt" DESC);

-- CreateIndex
CREATE INDEX "lead_activities_orgId_dueAt_idx" ON "public"."lead_activities"("orgId" ASC, "dueAt" ASC);

-- CreateIndex
CREATE INDEX "lead_activities_performedBy_idx" ON "public"."lead_activities"("performedBy" ASC);

-- CreateIndex
CREATE INDEX "lead_score_history_leadId_createdAt_idx" ON "public"."lead_score_history"("leadId" ASC, "createdAt" DESC);

-- CreateIndex
CREATE INDEX "leads_email_orgId_idx" ON "public"."leads"("email" ASC, "orgId" ASC);

-- CreateIndex
CREATE INDEX "leads_orgId_assignedTo_createdAt_idx" ON "public"."leads"("orgId" ASC, "assignedTo" ASC, "createdAt" DESC);

-- CreateIndex
CREATE INDEX "leads_orgId_createdAt_idx" ON "public"."leads"("orgId" ASC, "createdAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "leads_orgId_phone_key" ON "public"."leads"("orgId" ASC, "phone" ASC);

-- CreateIndex
CREATE INDEX "leads_orgId_score_idx" ON "public"."leads"("orgId" ASC, "score" DESC);

-- CreateIndex
CREATE INDEX "leads_orgId_status_idx" ON "public"."leads"("orgId" ASC, "status" ASC);

-- CreateIndex
CREATE INDEX "leads_phone_orgId_idx" ON "public"."leads"("phone" ASC, "orgId" ASC);

-- CreateIndex
CREATE INDEX "media_assets_orgId_createdAt_idx" ON "public"."media_assets"("orgId" ASC, "createdAt" DESC);

-- CreateIndex
CREATE INDEX "media_assets_orgId_folderId_idx" ON "public"."media_assets"("orgId" ASC, "folderId" ASC);

-- CreateIndex
CREATE INDEX "media_assets_orgId_isActive_idx" ON "public"."media_assets"("orgId" ASC, "isActive" ASC);

-- CreateIndex
CREATE INDEX "media_folders_orgId_parentId_idx" ON "public"."media_folders"("orgId" ASC, "parentId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "media_folders_orgId_path_key" ON "public"."media_folders"("orgId" ASC, "path" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "media_usages_assetId_entityType_entityId_fieldName_key" ON "public"."media_usages"("assetId" ASC, "entityType" ASC, "entityId" ASC, "fieldName" ASC);

-- CreateIndex
CREATE INDEX "media_usages_assetId_idx" ON "public"."media_usages"("assetId" ASC);

-- CreateIndex
CREATE INDEX "media_usages_entityType_entityId_idx" ON "public"."media_usages"("entityType" ASC, "entityId" ASC);

-- CreateIndex
CREATE INDEX "nav_menus_orgId_isActive_idx" ON "public"."nav_menus"("orgId" ASC, "isActive" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "nav_menus_orgId_location_key" ON "public"."nav_menus"("orgId" ASC, "location" ASC);

-- CreateIndex
CREATE INDEX "notification_logs_orgId_createdAt_idx" ON "public"."notification_logs"("orgId" ASC, "createdAt" DESC);

-- CreateIndex
CREATE INDEX "notification_logs_orgId_status_idx" ON "public"."notification_logs"("orgId" ASC, "status" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "notification_templates_orgId_event_channel_key" ON "public"."notification_templates"("orgId" ASC, "event" ASC, "channel" ASC);

-- CreateIndex
CREATE INDEX "organizations_isActive_idx" ON "public"."organizations"("isActive" ASC);

-- CreateIndex
CREATE INDEX "organizations_slug_idx" ON "public"."organizations"("slug" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "organizations_slug_key" ON "public"."organizations"("slug" ASC);

-- CreateIndex
CREATE INDEX "page_blocks_sectionId_order_idx" ON "public"."page_blocks"("sectionId" ASC, "order" ASC);

-- CreateIndex
CREATE INDEX "page_sections_pageId_order_idx" ON "public"."page_sections"("pageId" ASC, "order" ASC);

-- CreateIndex
CREATE INDEX "page_versions_pageId_createdAt_idx" ON "public"."page_versions"("pageId" ASC, "createdAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "page_versions_pageId_version_key" ON "public"."page_versions"("pageId" ASC, "version" ASC);

-- CreateIndex
CREATE INDEX "pages_orgId_createdAt_idx" ON "public"."pages"("orgId" ASC, "createdAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "pages_orgId_slug_key" ON "public"."pages"("orgId" ASC, "slug" ASC);

-- CreateIndex
CREATE INDEX "pages_orgId_status_idx" ON "public"."pages"("orgId" ASC, "status" ASC);

-- CreateIndex
CREATE INDEX "payment_transactions_admissionId_idx" ON "public"."payment_transactions"("admissionId" ASC);

-- CreateIndex
CREATE INDEX "payment_transactions_orgId_createdAt_idx" ON "public"."payment_transactions"("orgId" ASC, "createdAt" DESC);

-- CreateIndex
CREATE INDEX "payment_transactions_orgId_paidAt_idx" ON "public"."payment_transactions"("orgId" ASC, "paidAt" DESC);

-- CreateIndex
CREATE INDEX "payment_transactions_orgId_status_idx" ON "public"."payment_transactions"("orgId" ASC, "status" ASC);

-- CreateIndex
CREATE INDEX "payment_transactions_studentId_idx" ON "public"."payment_transactions"("studentId" ASC);

-- CreateIndex
CREATE INDEX "permissions_orgId_role_idx" ON "public"."permissions"("orgId" ASC, "role" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "permissions_orgId_role_resource_action_key" ON "public"."permissions"("orgId" ASC, "role" ASC, "resource" ASC, "action" ASC);

-- CreateIndex
CREATE INDEX "placements_orgId_batchYear_idx" ON "public"."placements"("orgId" ASC, "batchYear" ASC);

-- CreateIndex
CREATE INDEX "placements_orgId_status_idx" ON "public"."placements"("orgId" ASC, "status" ASC);

-- CreateIndex
CREATE INDEX "placements_orgId_studentId_idx" ON "public"."placements"("orgId" ASC, "studentId" ASC);

-- CreateIndex
CREATE INDEX "resources_orgId_category_idx" ON "public"."resources"("orgId" ASC, "category" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "resources_orgId_slug_key" ON "public"."resources"("orgId" ASC, "slug" ASC);

-- CreateIndex
CREATE INDEX "resources_orgId_status_idx" ON "public"."resources"("orgId" ASC, "status" ASC);

-- CreateIndex
CREATE INDEX "resources_orgId_type_idx" ON "public"."resources"("orgId" ASC, "type" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "sessions_sessionToken_key" ON "public"."sessions"("sessionToken" ASC);

-- CreateIndex
CREATE INDEX "sessions_userId_idx" ON "public"."sessions"("userId" ASC);

-- CreateIndex
CREATE INDEX "students_campusId_idx" ON "public"."students"("campusId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "students_leadId_key" ON "public"."students"("leadId" ASC);

-- CreateIndex
CREATE INDEX "students_orgId_createdAt_idx" ON "public"."students"("orgId" ASC, "createdAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "students_orgId_email_key" ON "public"."students"("orgId" ASC, "email" ASC);

-- CreateIndex
CREATE INDEX "students_orgId_status_idx" ON "public"."students"("orgId" ASC, "status" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "students_orgId_studentCode_key" ON "public"."students"("orgId" ASC, "studentCode" ASC);

-- CreateIndex
CREATE INDEX "testimonials_orgId_courseId_idx" ON "public"."testimonials"("orgId" ASC, "courseId" ASC);

-- CreateIndex
CREATE INDEX "testimonials_orgId_isFeatured_idx" ON "public"."testimonials"("orgId" ASC, "isFeatured" ASC);

-- CreateIndex
CREATE INDEX "testimonials_orgId_status_idx" ON "public"."testimonials"("orgId" ASC, "status" ASC);

-- CreateIndex
CREATE INDEX "users_email_idx" ON "public"."users"("email" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_orgId_key" ON "public"."users"("email" ASC, "orgId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "users_inviteToken_key" ON "public"."users"("inviteToken" ASC);

-- CreateIndex
CREATE INDEX "users_orgId_isActive_idx" ON "public"."users"("orgId" ASC, "isActive" ASC);

-- CreateIndex
CREATE INDEX "users_orgId_role_idx" ON "public"."users"("orgId" ASC, "role" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "verification_tokens_identifier_token_key" ON "public"."verification_tokens"("identifier" ASC, "token" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "verification_tokens_token_key" ON "public"."verification_tokens"("token" ASC);

-- CreateIndex
CREATE INDEX "workflow_runs_entityType_entityId_idx" ON "public"."workflow_runs"("entityType" ASC, "entityId" ASC);

-- CreateIndex
CREATE INDEX "workflow_runs_workflowId_idx" ON "public"."workflow_runs"("workflowId" ASC);

-- CreateIndex
CREATE INDEX "workflows_orgId_isActive_idx" ON "public"."workflows"("orgId" ASC, "isActive" ASC);

-- AddForeignKey
ALTER TABLE "public"."accounts" ADD CONSTRAINT "accounts_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."activity_feed_items" ADD CONSTRAINT "activity_feed_items_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "public"."users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."activity_feed_items" ADD CONSTRAINT "activity_feed_items_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "public"."organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."admission_stage_logs" ADD CONSTRAINT "admission_stage_logs_admissionId_fkey" FOREIGN KEY ("admissionId") REFERENCES "public"."admissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."admission_stage_logs" ADD CONSTRAINT "admission_stage_logs_changedBy_fkey" FOREIGN KEY ("changedBy") REFERENCES "public"."users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."admissions" ADD CONSTRAINT "admissions_campusId_fkey" FOREIGN KEY ("campusId") REFERENCES "public"."campuses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."admissions" ADD CONSTRAINT "admissions_counselorId_fkey" FOREIGN KEY ("counselorId") REFERENCES "public"."users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."admissions" ADD CONSTRAINT "admissions_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "public"."leads"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."admissions" ADD CONSTRAINT "admissions_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "public"."organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."admissions" ADD CONSTRAINT "admissions_stageChangedBy_fkey" FOREIGN KEY ("stageChangedBy") REFERENCES "public"."users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."admissions" ADD CONSTRAINT "admissions_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "public"."students"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."audit_logs" ADD CONSTRAINT "audit_logs_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "public"."organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."audit_logs" ADD CONSTRAINT "audit_logs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."campuses" ADD CONSTRAINT "campuses_headCounselorId_fkey" FOREIGN KEY ("headCounselorId") REFERENCES "public"."users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."campuses" ADD CONSTRAINT "campuses_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "public"."organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."content_blocks" ADD CONSTRAINT "content_blocks_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "public"."users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."content_blocks" ADD CONSTRAINT "content_blocks_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "public"."organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."course_versions" ADD CONSTRAINT "course_versions_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "public"."courses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."course_versions" ADD CONSTRAINT "course_versions_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "public"."users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."courses" ADD CONSTRAINT "courses_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "public"."users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."courses" ADD CONSTRAINT "courses_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "public"."organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."courses" ADD CONSTRAINT "courses_publishedBy_fkey" FOREIGN KEY ("publishedBy") REFERENCES "public"."users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."documents" ADD CONSTRAINT "documents_admissionId_fkey" FOREIGN KEY ("admissionId") REFERENCES "public"."admissions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."documents" ADD CONSTRAINT "documents_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "public"."organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."documents" ADD CONSTRAINT "documents_reviewedBy_fkey" FOREIGN KEY ("reviewedBy") REFERENCES "public"."users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."documents" ADD CONSTRAINT "documents_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "public"."students"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."documents" ADD CONSTRAINT "documents_uploadedBy_fkey" FOREIGN KEY ("uploadedBy") REFERENCES "public"."users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."event_log" ADD CONSTRAINT "event_log_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "public"."organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."feature_flags" ADD CONSTRAINT "feature_flags_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "public"."organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."hiring_partners" ADD CONSTRAINT "hiring_partners_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "public"."users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."hiring_partners" ADD CONSTRAINT "hiring_partners_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "public"."organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."job_applications" ADD CONSTRAINT "job_applications_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "public"."jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."job_applications" ADD CONSTRAINT "job_applications_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "public"."organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."job_applications" ADD CONSTRAINT "job_applications_reviewedBy_fkey" FOREIGN KEY ("reviewedBy") REFERENCES "public"."users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."job_applications" ADD CONSTRAINT "job_applications_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "public"."students"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."jobs" ADD CONSTRAINT "jobs_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "public"."users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."jobs" ADD CONSTRAINT "jobs_hiringPartnerId_fkey" FOREIGN KEY ("hiringPartnerId") REFERENCES "public"."hiring_partners"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."jobs" ADD CONSTRAINT "jobs_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "public"."organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."jobs" ADD CONSTRAINT "jobs_publishedBy_fkey" FOREIGN KEY ("publishedBy") REFERENCES "public"."users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."lead_activities" ADD CONSTRAINT "lead_activities_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "public"."leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."lead_activities" ADD CONSTRAINT "lead_activities_performedBy_fkey" FOREIGN KEY ("performedBy") REFERENCES "public"."users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."lead_score_history" ADD CONSTRAINT "lead_score_history_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "public"."leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."leads" ADD CONSTRAINT "leads_assignedTo_fkey" FOREIGN KEY ("assignedTo") REFERENCES "public"."users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."leads" ADD CONSTRAINT "leads_campusId_fkey" FOREIGN KEY ("campusId") REFERENCES "public"."campuses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."leads" ADD CONSTRAINT "leads_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "public"."users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."leads" ADD CONSTRAINT "leads_duplicateOf_fkey" FOREIGN KEY ("duplicateOf") REFERENCES "public"."leads"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."leads" ADD CONSTRAINT "leads_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "public"."organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."media_assets" ADD CONSTRAINT "media_assets_folderId_fkey" FOREIGN KEY ("folderId") REFERENCES "public"."media_folders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."media_assets" ADD CONSTRAINT "media_assets_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "public"."organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."media_assets" ADD CONSTRAINT "media_assets_replacedById_fkey" FOREIGN KEY ("replacedById") REFERENCES "public"."media_assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."media_assets" ADD CONSTRAINT "media_assets_uploadedBy_fkey" FOREIGN KEY ("uploadedBy") REFERENCES "public"."users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."media_folders" ADD CONSTRAINT "media_folders_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "public"."users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."media_folders" ADD CONSTRAINT "media_folders_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "public"."organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."media_folders" ADD CONSTRAINT "media_folders_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "public"."media_folders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."media_usages" ADD CONSTRAINT "media_usages_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "public"."media_assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."nav_menus" ADD CONSTRAINT "nav_menus_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "public"."users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."nav_menus" ADD CONSTRAINT "nav_menus_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "public"."organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."notification_logs" ADD CONSTRAINT "notification_logs_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "public"."notification_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."notification_templates" ADD CONSTRAINT "notification_templates_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "public"."organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."organizations" ADD CONSTRAINT "organizations_parentOrgId_fkey" FOREIGN KEY ("parentOrgId") REFERENCES "public"."organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."page_blocks" ADD CONSTRAINT "page_blocks_blockTypeId_fkey" FOREIGN KEY ("blockTypeId") REFERENCES "public"."content_blocks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."page_blocks" ADD CONSTRAINT "page_blocks_sectionId_fkey" FOREIGN KEY ("sectionId") REFERENCES "public"."page_sections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."page_sections" ADD CONSTRAINT "page_sections_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "public"."pages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."page_versions" ADD CONSTRAINT "page_versions_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "public"."users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."page_versions" ADD CONSTRAINT "page_versions_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "public"."pages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."pages" ADD CONSTRAINT "pages_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "public"."users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."pages" ADD CONSTRAINT "pages_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "public"."organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."pages" ADD CONSTRAINT "pages_publishedBy_fkey" FOREIGN KEY ("publishedBy") REFERENCES "public"."users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."payment_transactions" ADD CONSTRAINT "payment_transactions_admissionId_fkey" FOREIGN KEY ("admissionId") REFERENCES "public"."admissions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."payment_transactions" ADD CONSTRAINT "payment_transactions_campusId_fkey" FOREIGN KEY ("campusId") REFERENCES "public"."campuses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."payment_transactions" ADD CONSTRAINT "payment_transactions_collectedBy_fkey" FOREIGN KEY ("collectedBy") REFERENCES "public"."users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."payment_transactions" ADD CONSTRAINT "payment_transactions_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "public"."organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."payment_transactions" ADD CONSTRAINT "payment_transactions_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "public"."students"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."permissions" ADD CONSTRAINT "permissions_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "public"."organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."placements" ADD CONSTRAINT "placements_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "public"."users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."placements" ADD CONSTRAINT "placements_hiringPartnerId_fkey" FOREIGN KEY ("hiringPartnerId") REFERENCES "public"."hiring_partners"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."placements" ADD CONSTRAINT "placements_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "public"."organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."placements" ADD CONSTRAINT "placements_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "public"."students"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."resources" ADD CONSTRAINT "resources_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "public"."users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."resources" ADD CONSTRAINT "resources_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "public"."organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."sessions" ADD CONSTRAINT "sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."students" ADD CONSTRAINT "students_campusId_fkey" FOREIGN KEY ("campusId") REFERENCES "public"."campuses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."students" ADD CONSTRAINT "students_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "public"."leads"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."students" ADD CONSTRAINT "students_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "public"."organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."testimonials" ADD CONSTRAINT "testimonials_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "public"."organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."testimonials" ADD CONSTRAINT "testimonials_reviewedBy_fkey" FOREIGN KEY ("reviewedBy") REFERENCES "public"."users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."testimonials" ADD CONSTRAINT "testimonials_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "public"."students"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."users" ADD CONSTRAINT "users_campusId_fkey" FOREIGN KEY ("campusId") REFERENCES "public"."campuses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."users" ADD CONSTRAINT "users_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "public"."organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."workflow_runs" ADD CONSTRAINT "workflow_runs_triggeredBy_fkey" FOREIGN KEY ("triggeredBy") REFERENCES "public"."users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."workflow_runs" ADD CONSTRAINT "workflow_runs_workflowId_fkey" FOREIGN KEY ("workflowId") REFERENCES "public"."workflows"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."workflows" ADD CONSTRAINT "workflows_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "public"."organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

