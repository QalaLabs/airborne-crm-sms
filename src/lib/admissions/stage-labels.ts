import type { AdmissionStage } from "@prisma/client";

/**
 * The operational admission flow is: Prospect / Enquiry → Admission (fees paid,
 * documents submitted) → Verification → Enrolled, plus Cancelled and Dropped.
 *
 * "Admission" is stored as FEE_PAYMENT so no database enum change is needed
 * while the previous build is still live on the same database. The older
 * DOCUMENT_COLLECTION and OFFER_LETTER values are legacy aliases of it.
 */
export const ADMISSION_STAGE_FLOW: AdmissionStage[] = [
  "ENQUIRY",
  "FEE_PAYMENT",
  "VERIFICATION",
  "ENROLLED",
  "CANCELLED",
  "DROPPED",
];

const LEGACY_ADMISSION_ALIASES: Partial<Record<AdmissionStage, AdmissionStage>> = {
  DOCUMENT_COLLECTION: "FEE_PAYMENT",
  OFFER_LETTER: "FEE_PAYMENT",
};

const STAGE_LABELS: Record<AdmissionStage, string> = {
  ENQUIRY: "Prospect / Enquiry",
  DOCUMENT_COLLECTION: "Admission",
  FEE_PAYMENT: "Admission",
  OFFER_LETTER: "Admission",
  VERIFICATION: "Verification",
  ENROLLED: "Enrolled",
  CANCELLED: "Cancelled",
  DROPPED: "Dropped",
};

/** Maps legacy stages onto the stage they are now shown under. */
export function canonicalAdmissionStage(stage: string): string {
  return LEGACY_ADMISSION_ALIASES[stage as AdmissionStage] ?? stage;
}

export function admissionStageLabel(stage: string): string {
  return STAGE_LABELS[stage as AdmissionStage] ?? stage.replace(/_/g, " ");
}
