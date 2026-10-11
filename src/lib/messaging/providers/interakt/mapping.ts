import { CANONICAL_EVENTS } from "@/lib/events/catalog";
import {
  customFieldString,
  leadSourceGroup,
  normalizeCourseKey,
} from "./course-routing";

// Lead → Interakt user traits / tags. Keys stay ASCII; Interakt filters on them.

export interface LeadTrackSource {
  id: string;
  name: string;
  email?: string | null;
  phone: string;
  courseInterest?: string | null;
  status: string;
  tags?: string[];
  city?: string | null;
  source?: string | null;
  whatsappOptOut?: boolean;
  landingPage?: string | null;
  utmCampaign?: string | null;
  utmSource?: string | null;
  utmMedium?: string | null;
  utmTerm?: string | null;
  utmContent?: string | null;
  createdAt?: Date | string | null;
  customFields?: unknown;
}

function omitEmpty(traits: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(traits)) {
    if (value === undefined || value === null || value === "") continue;
    out[key] = value;
  }
  return out;
}

function createdAtIso(value?: Date | string | null): string | undefined {
  if (!value) return undefined;
  if (value instanceof Date) return value.toISOString();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
}

/** Traits sent on User Track. Only values that exist on the Lead (or computed from them). */
export function leadToUserTraits(lead: LeadTrackSource): Record<string, unknown> {
  const course = normalizeCourseKey(lead.courseInterest);
  const adSet =
    customFieldString(lead.customFields, "googleAdsAdgroupId") ??
    customFieldString(lead.customFields, "ad_set");
  const ad =
    customFieldString(lead.customFields, "googleAdsCreativeId") ??
    customFieldString(lead.customFields, "ad");

  return omitEmpty({
    name: lead.name,
    email: lead.email ?? undefined,
    airborne_lead_id: lead.id,
    lead_source: lead.source ?? undefined,
    lead_source_group: lead.source ? leadSourceGroup(lead.source) : undefined,
    course,
    course_interest: lead.courseInterest ?? undefined,
    landing_page: lead.landingPage ?? undefined,
    campaign: lead.utmCampaign ?? undefined,
    utm_source: lead.utmSource ?? undefined,
    utm_medium: lead.utmMedium ?? undefined,
    utm_term: lead.utmTerm ?? undefined,
    utm_content: lead.utmContent ?? undefined,
    ad_set: adSet,
    ad,
    lead_created_at: createdAtIso(lead.createdAt),
    leadStatus: lead.status,
    city: lead.city ?? undefined,
    whatsappOptOut: lead.whatsappOptOut === true,
  });
}

/** Event Track traits for the single `lead_created` Interakt custom event. */
export function leadToCreatedEventTraits(lead: LeadTrackSource): Record<string, unknown> {
  const course = normalizeCourseKey(lead.courseInterest);
  const adSet =
    customFieldString(lead.customFields, "googleAdsAdgroupId") ??
    customFieldString(lead.customFields, "ad_set");
  const ad =
    customFieldString(lead.customFields, "googleAdsCreativeId") ??
    customFieldString(lead.customFields, "ad");

  return omitEmpty({
    airborne_lead_id: lead.id,
    lead_source: lead.source ?? undefined,
    lead_source_group: lead.source ? leadSourceGroup(lead.source) : undefined,
    course,
    course_interest: lead.courseInterest ?? undefined,
    landing_page: lead.landingPage ?? undefined,
    campaign: lead.utmCampaign ?? undefined,
    ad_set: adSet,
    ad,
    email: lead.email ?? undefined,
    lead_created_at: createdAtIso(lead.createdAt),
  });
}

export function leadToUserTags(lead: LeadTrackSource): string[] {
  const tags = [...(lead.tags ?? [])];
  if (lead.status) tags.push(`status:${lead.status}`);
  const course = normalizeCourseKey(lead.courseInterest);
  if (course !== "unknown") tags.push(`course:${course}`);
  else if (lead.courseInterest) tags.push(`course:${lead.courseInterest}`);
  if (lead.source) tags.push(`source:${lead.source}`);
  if (lead.whatsappOptOut) tags.push("whatsapp-opted-out");
  return tags;
}

/**
 * Canonical internal event → Interakt Event Track name.
 * Lead creation uses ONE custom event (`lead_created`) so Interakt Advanced
 * branches on traits instead of burning a slot per course.
 */
export const INTERAKT_LEAD_CREATED_EVENT = "lead_created";

export const INTERAKT_EVENT_NAMES: Record<string, string> = {
  [CANONICAL_EVENTS.LEAD_CREATED]: INTERAKT_LEAD_CREATED_EVENT,
  "lead/created": INTERAKT_LEAD_CREATED_EVENT,
  [CANONICAL_EVENTS.LEAD_STATUS_CHANGED]: "lead.status_changed",
  "lead/status.changed": "lead.status_changed",
  [CANONICAL_EVENTS.LEAD_ASSIGNED]: "lead.assigned",
  "lead/assigned": "lead.assigned",
  [CANONICAL_EVENTS.PAYMENT_PENDING]: "payment.pending",
  [CANONICAL_EVENTS.PAYMENT_SUCCESS]: "payment.success",
  "payment/received": "payment.success",
  [CANONICAL_EVENTS.PAYMENT_FAILED]: "payment.failed",
  [CANONICAL_EVENTS.COURSE_ENROLLED]: "course.enrolled",
  [CANONICAL_EVENTS.WHATSAPP_OPTED_OUT]: "whatsapp.opted_out",
  [CANONICAL_EVENTS.WHATSAPP_REPLIED]: "whatsapp.replied",
};

export function interaktEventName(internalEvent: string): string | null {
  return INTERAKT_EVENT_NAMES[internalEvent] ?? null;
}

export function isLeadCreatedEventName(internalEvent: string): boolean {
  return internalEvent === "lead/created" || internalEvent === CANONICAL_EVENTS.LEAD_CREATED;
}
