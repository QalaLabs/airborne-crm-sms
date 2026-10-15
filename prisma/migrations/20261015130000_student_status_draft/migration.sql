-- Imported won leads get a student record that stays DRAFT until the dossier is enrolled.
ALTER TYPE "StudentStatus" ADD VALUE IF NOT EXISTS 'DRAFT';
