import { timingSafeEqual } from "node:crypto";
import type { PrismaClient, Prisma, LeadSource, LeadStatus } from "@prisma/client";
import type { EmitLeadCreatedInput } from "@/lib/automation/emit-lead-created";

// ─── Google Ads Lead Form webhook contract (developers.google.com/google-ads/webhook/docs/implementation) ───
// POST JSON payload:
//   lead_id (string, optional in proto but always populated in practice)   — use for dedup
//   api_version (string)                                                    — schema version, ignore for now
//   form_id / campaign_id / adgroup_id / creative_id / asset_group_id (int64)
//   google_key (string)                                                     — advertiser-configured key; validate before processing
//   gcl_id (string)                                                         — Google click ID
//   is_test (bool)                                                          — true => test lead
//   lead_stage (string)  /  lead_submit_time (ISO-8601)  /  lead_source ("LEAD_FORM" | "CONVERSATIONAL_AGENT")
//   user_column_data[]: { column_id, string_value, column_name (deprecated) }
// Duplicates: a single lead is not guaranteed to be delivered exactly once — dedupe on lead_id.
// HTTP contract: 200 = success, 4XX = client error (no retry), 5XX = retryable.

export interface GoogleAdsColumn {
  column_id?: string;
  string_value?: string;
  column_name?: string;
}

export interface GoogleAdsWebhookPayload {
  lead_id?: string;
  api_version?: string;
  form_id?: string | number;
  campaign_id?: string | number;
  adgroup_id?: string | number;
  creative_id?: string | number;
  asset_group_id?: string | number;
  google_key?: string;
  gcl_id?: string;
  is_test?: boolean;
  lead_stage?: string;
  lead_submit_time?: string;
  lead_source?: string;
  user_column_data?: GoogleAdsColumn[];
}

export type GoogleAdsWebhookResult =
  | { kind: "bad_request"; reason: "missing_lead_id" | "invalid_user_column_data" }
  | { kind: "created"; leadId: string; test: boolean }
  | { kind: "replayed"; leadId: string; test: boolean }
  | { kind: "duplicate"; leadId: string; test: boolean }
  | { kind: "skipped_no_phone" }
  | { kind: "skipped_intake_closed" };

export type GoogleAdsWebhookDb = Pick<
  PrismaClient,
  "lead" | "leadActivity" | "$transaction"
>;

export interface GoogleAdsWebhookDeps {
  db: GoogleAdsWebhookDb;
  emitLeadCreated: (input: EmitLeadCreatedInput) => Promise<void>;
  writeAudit: (input: {
    orgId: string;
    action: string;
    entityType: string;
    entityId?: string;
    newValue?: Record<string, unknown>;
    ipAddress?: string;
  }) => Promise<void>;
  writeActivityFeed: (input: {
    orgId: string;
    verb: string;
    objectType: string;
    objectId: string;
    objectSnapshot: Record<string, unknown>;
    context?: Record<string, unknown>;
  }) => Promise<void>;
  log: (structured: Record<string, unknown>) => void;
  now: () => Date;
}

const SOURCE = "GOOGLE_ADS" as LeadSource;
const ACTOR_NAME = "Google Ads Lead Form";
const IP_ADDRESS = "google-ads";

type LeadLike = {
  id: string;
  name: string;
  courseInterest?: string | null;
  status?: string;
  createdAt?: Date;
  customFields?: unknown;
};

function iso(v: string | number | undefined): string | null {
  if (v === undefined || v === null) return null;
  return String(v);
}

function col(data: GoogleAdsColumn[], id: string): string | undefined {
  return data.find((c) => c.column_id === id)?.string_value?.trim() || undefined;
}

/** True when a lead row is a synthetic Google "Send test data" submission. */
export function isTestLeadRow(lead: Pick<LeadLike, "status" | "customFields">): boolean {
  if (lead.status === "TEST_LEAD") return true;
  if (lead.customFields && typeof lead.customFields === "object" && !Array.isArray(lead.customFields)) {
    return (lead.customFields as Record<string, unknown>).googleAdsTestLead === true;
  }
  return false;
}

/**
 * Timing-safe comparison against one or more acceptable secrets. Google sends
 * the same key for test and production payloads; we accept the org-settings
 * key (rotated from the Admin UI, effective immediately) OR the env-var key
 * (Cloud Run / Secret Manager bootstrap). Length mismatch returns false early,
 * which also makes the comparison constant-time per secret length.
 */
export function isGoogleAdsKeyValid(
  provided: string | undefined,
  ...secrets: Array<string | null | undefined>
): boolean {
  if (!provided) return false;
  const providedBuf = Buffer.from(provided);
  for (const secret of secrets) {
    if (!secret) continue;
    const expectedBuf = Buffer.from(secret);
    if (providedBuf.length !== expectedBuf.length) continue;
    if (timingSafeEqual(providedBuf, expectedBuf)) return true;
  }
  return false;
}

/** Org settings may hold a UI-generated webhook key (dev fallback / rotated key). */
export function orgWebhookKey(settings: unknown): string | null {
  if (!settings || typeof settings !== "object" || Array.isArray(settings)) return null;
  const raw = (settings as Record<string, unknown>).googleAdsWebhookSecret;
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Core Google Ads lead processing. Extracted from the route so the full
 * contract (auth, mapping, idempotency, errors, downstream) is unit-testable.
 *
 * No PII is ever logged; only Google lead_id / internal lead id / event name.
 */
export async function processGoogleAdsLead(params: {
  orgId: string;
  orgSettings: unknown;
  payload: GoogleAdsWebhookPayload;
  deps: GoogleAdsWebhookDeps;
}): Promise<GoogleAdsWebhookResult> {
  const { orgId, orgSettings, payload, deps } = params;
  const { db, log, now } = deps;

  if (!payload.lead_id || typeof payload.lead_id !== "string") {
    return { kind: "bad_request", reason: "missing_lead_id" };
  }
  if (payload.user_column_data !== undefined && !Array.isArray(payload.user_column_data)) {
    return { kind: "bad_request", reason: "invalid_user_column_data" };
  }

  const leadId = payload.lead_id;
  const isTest = payload.is_test === true;
  const columns = Array.isArray(payload.user_column_data) ? payload.user_column_data : [];

  // ── Field mapping (Google column_id → Lead model) ──────────────────────────
  const fullName = col(columns, "FULL_NAME");
  const firstName = col(columns, "FIRST_NAME") ?? col(columns, "GIVEN_NAME");
  const lastName = col(columns, "LAST_NAME") ?? col(columns, "FAMILY_NAME");
  const name =
    fullName ??
    (firstName && lastName ? `${firstName} ${lastName}` : firstName ?? lastName ?? "Unknown");
  const phone = col(columns, "PHONE_NUMBER");
  const email = col(columns, "EMAIL");
  // Standard column first, then Google education/question fields whose
  // column_id contains program/course/interest. Google aviation lead forms
  // commonly use EDUCATION_PROGRAM / EDUCATION_COURSE.
  const courseInterest =
    col(columns, "COURSE_INTEREST") ??
    columns.find(
      (c) =>
        ["program", "course", "interest"].some((kw) =>
          (c.column_id ?? "").toLowerCase().includes(kw),
        ),
    )?.string_value?.trim();

  if (!phone) {
    log({
      event: "google_ads_lead_skipped",
      reason: "no_phone",
      googleAdsLeadId: leadId,
      timestamp: now().toISOString(),
    });
    return { kind: "skipped_no_phone" };
  }

  const normalizedPhone = phone.replace(/\s+/g, "").trim();

  // ── Idempotency: dedupe on Google's globally-unique lead_id ────────────────
  const existing = await db.lead.findFirst({
    where: {
      orgId,
      customFields: { path: ["googleAdsLeadId"], equals: leadId },
    },
    select: { id: true, name: true, courseInterest: true, status: true, customFields: true },
  });

  if (existing) {
    const testRow = isTestLeadRow(existing);
    if (!testRow) {
      await deps.emitLeadCreated({
        orgId,
        leadId: existing.id,
        leadName: existing.name,
        source: SOURCE,
        courseInterest: existing.courseInterest,
        actorName: ACTOR_NAME,
        ipAddress: IP_ADDRESS,
      });
    }
    log({
      event: testRow ? "google_ads_test_lead_replayed" : "google_ads_lead_replayed",
      googleAdsLeadId: leadId,
      leadId: existing.id,
      timestamp: now().toISOString(),
    });
    return { kind: "replayed", leadId: existing.id, test: testRow };
  }

  // ── Intake gate (applies to production leads; test payloads still verify) ──
  const settings = orgSettings as Record<string, unknown> | null;
  if (!isTest && settings?.applicationIntake === false) {
    log({
      event: "google_ads_lead_skipped",
      reason: "intake_closed",
      googleAdsLeadId: leadId,
      timestamp: now().toISOString(),
    });
    return { kind: "skipped_intake_closed" };
  }

  // ── Atomic lead create + activity + touch ──────────────────────────────────
  const customFields: Prisma.InputJsonValue = {
    googleAdsLeadId: leadId,
    googleAdsFormId: iso(payload.form_id),
    googleAdsCampaignId: iso(payload.campaign_id),
    googleAdsAdgroupId: iso(payload.adgroup_id),
    googleAdsCreativeId: iso(payload.creative_id),
    googleAdsAssetGroupId: iso(payload.asset_group_id),
    googleAdsLeadStage: payload.lead_stage ?? null,
    googleAdsLeadSubmitTime: payload.lead_submit_time ?? null,
    googleAdsLeadSource: payload.lead_source ?? null,
    googleAdsApiVersion: payload.api_version ?? null,
    gclId: payload.gcl_id ?? null,
    webSource: "google_ads_lead_form",
    ...(isTest ? { googleAdsTestLead: true } : {}),
    googleAdsRawPayload: payload as unknown as Prisma.InputJsonValue,
  };

  let lead: { id: string; name: string };
  try {
    lead = await db.$transaction(async (tx) => {
      const created = await tx.lead.create({
        data: {
          name,
          email: email ?? null,
          phone: normalizedPhone,
          courseInterest: courseInterest ?? null,
          source: SOURCE,
          ...(isTest ? { status: "TEST_LEAD" as LeadStatus } : {}),
          orgId,
          utmSource: "google_ads",
          utmMedium: "cpc",
          utmCampaign: iso(payload.campaign_id),
          customFields,
        },
        select: { id: true, name: true, createdAt: true },
      });

      await tx.leadActivity.create({
        data: {
          leadId: created.id,
          orgId,
          activityType: "NOTE",
          title: isTest ? "Google Ads Test Lead" : "Google Ads Lead Form",
          notes: `Lead received via Google Ads Lead Form Extension (Form ID: ${payload.form_id ?? "unknown"}${
            isTest ? " — synthetic test data" : ""
          })`,
          completedAt: now(),
          metadata: {
            source: SOURCE,
            googleAdsLeadId: leadId,
            formId: payload.form_id,
            campaignId: payload.campaign_id,
            test: isTest,
          },
        },
      });

      await tx.lead.update({
        where: { id: created.id },
        data: { lastActivityAt: now() },
      });

      return { id: created.id, name: created.name };
    });
  } catch (err) {
    const isP2002 =
      typeof err === "object" &&
      err !== null &&
      "code" in err &&
      (err as { code?: string }).code === "P2002";
    if (isP2002) {
      // unique(orgId, phone) — a lead with this phone already exists. Google
      // retries deliver the same submission; converge on the existing lead.
      const raced = await db.lead.findFirst({
        where: { orgId, phone: normalizedPhone },
        select: { id: true, name: true, courseInterest: true, status: true, customFields: true },
      });
      if (raced) {
        const racedIsTest = isTestLeadRow(raced);
        if (!racedIsTest) {
          await deps.emitLeadCreated({
            orgId,
            leadId: raced.id,
            leadName: raced.name,
            source: SOURCE,
            courseInterest: raced.courseInterest ?? courseInterest,
            actorName: ACTOR_NAME,
            ipAddress: IP_ADDRESS,
          });
        }
        log({
          event: racedIsTest ? "google_ads_test_lead_duplicate" : "google_ads_lead_duplicate",
          googleAdsLeadId: leadId,
          leadId: raced.id,
          timestamp: now().toISOString(),
        });
        return { kind: "duplicate", leadId: raced.id, test: racedIsTest };
      }
    }
    throw err;
  }

  log({
    event: "google_ads_lead_saved",
    leadId: lead.id,
    googleAdsLeadId: leadId,
    test: isTest,
    timestamp: now().toISOString(),
  });

  // ── Audit + activity feed + canonical lead.created (real leads only) ───────
  // Test payloads are persisted for end-to-end verification but never enter the
  // WhatsApp/Interakt automation pipeline (synthetic data would spam templates).
  if (!isTest) {
    await deps.writeAudit({
      orgId,
      action: "lead.created",
      entityType: "lead",
      entityId: lead.id,
      newValue: { name: lead.name, source: SOURCE },
      ipAddress: IP_ADDRESS,
    });

    await deps.writeActivityFeed({
      orgId,
      verb: "created",
      objectType: "lead",
      objectId: lead.id,
      objectSnapshot: { name: lead.name, source: SOURCE },
      context: { actorName: ACTOR_NAME },
    });

    await deps.emitLeadCreated({
      orgId,
      leadId: lead.id,
      leadName: lead.name,
      source: SOURCE,
      courseInterest: courseInterest ?? undefined,
      actorName: ACTOR_NAME,
      ipAddress: IP_ADDRESS,
    });
  }

  return { kind: "created", leadId: lead.id, test: isTest };
}