/**
 * Map CRM courseInterest / LeadSource to stable Interakt traits.
 * Computed only — does not invent Lead columns. Interakt Advanced branches
 * on these keys; Airborne never infers course from a WhatsApp message.
 */

export type CourseKey = "dgca_cpl" | "cabin_crew" | "cadet_pilot" | "unknown";

export type LeadSourceGroup =
  | "google"
  | "facebook"
  | "website"
  | "manual"
  | "referral"
  | "whatsapp"
  | "other";

const CPL_RE = /\b(dgca\s*)?cpl\b|commercial\s+pilot/i;
const CABIN_RE = /cabin\s*crew|air\s*hostess|steward/i;
const CADET_RE = /cadet(\s+pilot)?|cadet\s*prep/i;

export function normalizeCourseKey(courseInterest?: string | null): CourseKey {
  const raw = courseInterest?.trim() ?? "";
  if (!raw) return "unknown";
  if (CABIN_RE.test(raw)) return "cabin_crew";
  if (CADET_RE.test(raw)) return "cadet_pilot";
  if (CPL_RE.test(raw)) return "dgca_cpl";
  const compact = raw.toLowerCase().replace(/[\s-]+/g, "_");
  if (compact === "dgca_cpl" || compact === "cpl") return "dgca_cpl";
  if (compact === "cabin_crew") return "cabin_crew";
  if (compact === "cadet_pilot") return "cadet_pilot";
  return "unknown";
}

export function leadSourceGroup(source?: string | null): LeadSourceGroup {
  switch (source) {
    case "GOOGLE_ADS":
      return "google";
    case "FACEBOOK_ADS":
      return "facebook";
    case "HOMEPAGE_CTA":
    case "COURSE_PAGE":
    case "CONTACT_FORM":
    case "CALLBACK_REQUEST":
    case "BROCHURE_DOWNLOAD":
    case "ORGANIC":
      return "website";
    case "DIRECT":
    case "WALK_IN":
      return "manual";
    case "REFERRAL":
      return "referral";
    case "WHATSAPP":
      return "whatsapp";
    default:
      return "other";
  }
}

export function jsonString(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return undefined;
}

export function customFieldString(
  customFields: unknown,
  key: string,
): string | undefined {
  if (!customFields || typeof customFields !== "object" || Array.isArray(customFields)) {
    return undefined;
  }
  return jsonString((customFields as Record<string, unknown>)[key]);
}
