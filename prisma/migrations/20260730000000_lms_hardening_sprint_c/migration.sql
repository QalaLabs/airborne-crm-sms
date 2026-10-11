-- Sprint C hardening: enforce quiz attempt ordering and certificate verification codes.

-- Prevent concurrent quiz submissions from exceeding maxAttempts or duplicating
-- attemptNumber for the same (student, module). Backstop for the transactional
-- attempt-creation in LmsService.submitQuiz.
CREATE UNIQUE INDEX IF NOT EXISTS "lms_quiz_attempts_studentId_moduleId_attemptNumber_key"
  ON "lms_quiz_attempts"("studentId", "moduleId", "attemptNumber");

-- Each verificationCode must be unique within an organization. Postgres treats
-- NULLs as distinct, so DRAFT certificates with NULL codes are unaffected.
CREATE UNIQUE INDEX IF NOT EXISTS "lms_certificates_orgId_verificationCode_key"
  ON "lms_certificates"("orgId", "verificationCode");
