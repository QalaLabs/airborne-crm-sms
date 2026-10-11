-- Phase 2 — Lead Management workflow + profile fields (additive, non-destructive)

-- 1) LeadStatus enum: add the Phase 2 workflow hierarchy values.
--    Existing values (NEW / CONTACTED / INTERESTED / FOLLOW_UP / COUNSELED /
--    APPLICATION_SUBMITTED / CONVERTED / LOST) are preserved so current data
--    and automation keep working.
ALTER TYPE "public"."LeadStatus" ADD VALUE 'CONNECTED';
ALTER TYPE "public"."LeadStatus" ADD VALUE 'CALL_BACK';
ALTER TYPE "public"."LeadStatus" ADD VALUE 'PROSPECT';
ALTER TYPE "public"."LeadStatus" ADD VALUE 'WON';
ALTER TYPE "public"."LeadStatus" ADD VALUE 'NOT_CONNECTED';
ALTER TYPE "public"."LeadStatus" ADD VALUE 'RINGING';
ALTER TYPE "public"."LeadStatus" ADD VALUE 'NOT_REACHABLE';
ALTER TYPE "public"."LeadStatus" ADD VALUE 'SWITCHED_OFF';
ALTER TYPE "public"."LeadStatus" ADD VALUE 'VOICEMAIL';
ALTER TYPE "public"."LeadStatus" ADD VALUE 'INCOMING_BARD';
ALTER TYPE "public"."LeadStatus" ADD VALUE 'OUT_OF_SERVICE';
ALTER TYPE "public"."LeadStatus" ADD VALUE 'NOT_AWARE';
ALTER TYPE "public"."LeadStatus" ADD VALUE 'NOT_CONTACTABLE';
ALTER TYPE "public"."LeadStatus" ADD VALUE 'LOCATION_OUT_OF_SCOPE';
ALTER TYPE "public"."LeadStatus" ADD VALUE 'LANGUAGE_BARRIER';
ALTER TYPE "public"."LeadStatus" ADD VALUE 'PRICE_HIGH';
ALTER TYPE "public"."LeadStatus" ADD VALUE 'JOINED_OTHERS';
ALTER TYPE "public"."LeadStatus" ADD VALUE 'NOT_ELIGIBLE';
ALTER TYPE "public"."LeadStatus" ADD VALUE 'INVALID_NUMBER';
ALTER TYPE "public"."LeadStatus" ADD VALUE 'TEST_LEAD';

-- 2) Lead profile fields captured from Enroll Now / lead intake
ALTER TABLE "public"."leads" ADD COLUMN "pincode" VARCHAR(10);
ALTER TABLE "public"."leads" ADD COLUMN "googleId" VARCHAR(255);
ALTER TABLE "public"."leads" ADD COLUMN "manualAmount" DECIMAL(12, 2);