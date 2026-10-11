import { createHmac, timingSafeEqual } from "node:crypto";
import type { PrismaClient, Prisma, LeadSource, LeadStatus } from "@prisma/client";
import type { EmitLeadCreatedInput } from "@/lib/automation/emit-lead-created";
import { contactCandidates } from "@/lib/messaging/phone";

// ─── Meta/Facebook Lead Ads webhook contract ─────────────────────────────────
// GET (subscription verification): ?hub.mode=subscribe&hub.verify_token=...&hub.challenge=...
//   → echo hub.challenge when mode === "subscribe" and verify_token matches.
// POST (notifications): JSON body
//   { object: "page", entry: [ { id, time, changes: [
//       { field: "leadgen", value: {
//           leadgen_id: string, page_id: string, form_id: string,
//           created_time: number, is_test: boolean } } ] } ] }
// Auth: header `X-Hub-Signature-256: sha256=<hmac-sha256(app_secret, rawBody)>`.
// Duplicates: Meta may redeliver — dedupe on leadgen_id (customFields.leadgenId).
// Lead data is NOT in the notification: we POST-SCRAPED leadgen_id to Graph
//   `/v20.0/{leadgen_id}` (URL-encoded, incl. leading slash) with the Page
//   access token + appsecret_proof. field_data[] → lead fields.
// HTTP contract: 200 = success; non-2xx from our webhook → Meta retries later.

interface MetaLeadGenChangeValue {
  leadgen_id?: string;
  page_id?: string;
  form_id?: string;
  created_time?: number;
  is_test?: boolean;
}

export interface MetaLeadGenEntry {
  id?: string;
  time?: number;
  changes?: Array<{
    field?: string;
    value?: MetaLeadGenChangeValue;
  }>;
}

export interface MetaWebhookPayload {
  object?: string;
  entry?: MetaLeadGenEntry[];
}

export interface MetaLeadField {
  name?: string;
  values?: Array<string | number>;
}

export interface MetaLeadGenGraphLead {
  id?: string;
  created_time?: string;
  campaign_id?: string;
  field_data?: MetaLeadField[];
  is_test?: boolean;
}

export type FetchGraph = (
  leadgenId: string,
  accessToken: string,
  appSecret: string,
) => Promise<{ ok: boolean; status: number; json: unknown }>;

export type MetaWebhookResult =
  | { kind: "bad_request"; reason: "missing_leadgen_id" | "invalid_entry" }
  | { kind: "not_configured" }
  | { kind: "provider_error"; reason: "graph_fetch_failed" | "graph_empty" }
  | { kind: "created"; leadId: string; test: boolean }
  | { kind: "replayed"; leadId: string; test: boolean }
  | { kind: "duplicate"; leadId: string; test: boolean }
  | { kind: "skipped_no_phone" };

export type MetaWebhookDb = Pick<
  PrismaClient,
  "lead" | "leadActivity" | "$transaction"
>;

export interface MetaWebhookDeps {
  db: MetaWebhookDb;
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
  fetchGraph: FetchGraph;
  log: (structured: Record<string, unknown>) => void;
  now: () => Date;
}

const SOURCE = "FACEBOOK_ADS" as LeadSource;
const ACTOR_NAME = "Facebook Lead Ads";
const IP_ADDRESS = "facebook-leadgen";
const GRAPH_URL = "https://graph.facebook.com";

function valueAsString(v: string | number | undefined): string | undefined {
  if (v === undefined || v === null) return undefined;
  return String(v).trim();
}

/**
 * Timing-safe comparison of the `X-Hub-Signature-256` header against the
 * HMAC-SHA256 of the raw body signed with the app secret ("sha256=" prefix).
 * Length mismatch short-circuits, keeping it constant-time per secret length.
 */
export function verifyMetaSignature(
  appSecret: string | undefined,
  signatureHeader: string | null | undefined,
  rawBody: string,
): boolean {
  if (!appSecret || !signatureHeader) return false;
  if (!signatureHeader.startsWith("sha256=")) return false;
  const provided = signatureHeader.slice("sha256=".length);
  const expected = createHmac("sha256", appSecret).update(rawBody, "utf8").digest("hex");
  const providedBuf = Buffer.from(provided);
  const expectedBuf = Buffer.from(expected);
  if (providedBuf.length !== expectedBuf.length) return false;
  return timingSafeEqual(providedBuf, expectedBuf);
}

/** Subscription verification handshake per Meta docs. */
export function hubChallengeMatches(
  mode: string | null,
  verifyToken: string | null,
  configuredToken: string | undefined,
): boolean {
  if (mode !== "subscribe") return false;
  if (!verifyToken || !configuredToken) return false;
  if (verifyToken.length !== configuredToken.length) return false;
  return timingSafeEqual(Buffer.from(verifyToken), Buffer.from(configuredToken));
}

/** Default Graph implementation used by the route. Throws → provider_error. */
export const defaultFetchGraph: FetchGraph = async (leadgenId, accessToken, appSecret) => {
  const proof = createHmac("sha256", appSecret).update(accessToken, "utf8").digest("hex");
  const path = encodeURIComponent(`/${leadgenId}`);
  const url =
    `${GRAPH_URL}/v20.0${path}?fields=id,created_time,campaign_id,field_data,is_test` +
    `&access_token=${encodeURIComponent(accessToken)}&appsecret_proof=${encodeURIComponent(proof)}`;
  const res = await fetch(url, {
    method: "GET",
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(10_000),
  });
  let json: unknown = null;
  try {
    json = await res.json();
  } catch {
    json = null;
  }
  return { ok: res.ok, status: res.status, json };
};

function iso(v: string | number | undefined): string | null {
  if (v === undefined || v === null) return null;
  return String(v);
}

function phoneFrom(fields: MetaLeadField[]): string | undefined {
  const p = fields.find(
    (f) =>
      ["phone_number", "phone", "mobile", "whatsapp", "phone_no"].includes((f.name ?? "").toLowerCase()) ||
      (f.name ?? "").toLowerCase().includes("phone"),
  )?.values?.[0];
  return valueAsString(p);
}

function emailFrom(fields: MetaLeadField[]): string | undefined {
  const e = fields.find((f) => (f.name ?? "").toLowerCase().includes("email"))?.values?.[0];
  return valueAsString(e);
}

function nameFrom(fields: MetaLeadField[]): string {
  const full = fields.find((f) => ["full_name", "fullname"].includes((f.name ?? "").toLowerCase()))?.values?.[0];
  const first = fields.find((f) => ["first_name", "firstname"].includes((f.name ?? "").toLowerCase()))?.values?.[0];
  const last = fields.find((f) => ["last_name", "lastname"].includes((f.name ?? "").toLowerCase()))?.values?.[0];
  return (
    valueAsString(full) ??
    (valueAsString(first) && valueAsString(last) ? `${first} ${last}` : valueAsString(first) ?? valueAsString(last) ?? "Unknown")
  );
}

function courseFrom(fields: MetaLeadField[]): string | undefined {
  const course = fields.find(
    (f) => ["course", "course_interest", "program", "interest"].includes((f.name ?? "").toLowerCase()),
  )?.values?.[0];
  const out = valueAsString(course);
  return out || undefined;
}

/**
 * Meta batches several entries / leadgen changes into one delivery. Each change
 * is processed on its own (leadgen_id dedupe makes redelivery safe). The batch
 * result is the most severe outcome: any transient provider error → retry.
 */
export async function processMetaLeadGenBatch(
  params: Parameters<typeof processMetaLeadGen>[0],
): Promise<{ result: MetaWebhookResult; results: MetaWebhookResult[] }> {
  const singles: MetaWebhookPayload[] = [];
  for (const entry of params.payload.entry ?? []) {
    for (const change of entry?.changes ?? []) {
      if (change?.field === "leadgen") {
        singles.push({ object: params.payload.object, entry: [{ ...entry, changes: [change] }] });
      }
    }
  }
  if (singles.length <= 1) {
    const result = await processMetaLeadGen(params);
    return { result, results: [result] };
  }

  const results: MetaWebhookResult[] = [];
  for (const payload of singles) {
    results.push(await processMetaLeadGen({ ...params, payload }));
  }
  const severity: Record<MetaWebhookResult["kind"], number> = {
    not_configured: 5,
    provider_error: 4,
    bad_request: 3,
    created: 2,
    duplicate: 1,
    replayed: 1,
    skipped_no_phone: 0,
  };
  const result = results.reduce((worst, r) => (severity[r.kind] > severity[worst.kind] ? r : worst));
  return { result, results };
}

/**
 * Core Meta lead-Gen processing. Extracted from the route so the full contract
 * (signature → map → dedup → Graph fetch → create → event) is unit-testable.
 * No PII is ever logged — only leadgen_id / internal lead id / event name.
 */
export async function processMetaLeadGen(params: {
  orgId: string;
  orgSettings: unknown;
  appSecret: string | undefined;
  pageAccessToken: string | undefined;
  payload: MetaWebhookPayload;
  deps: MetaWebhookDeps;
}): Promise<MetaWebhookResult> {
  const { orgId, orgSettings, appSecret, pageAccessToken, payload, deps } = params;
  const { db, log, now } = deps;

  if (!appSecret) {
    log({ event: "facebook_leadgen_not_configured", reason: "no_app_secret", timestamp: now().toISOString() });
    return { kind: "not_configured" };
  }

  const value = payload.entry?.[0]?.changes?.find((c) => c.field === "leadgen")?.value;
  if (!value || (typeof value.leadgen_id !== "string") || !value.leadgen_id) {
    return { kind: "bad_request", reason: "missing_leadgen_id" };
  }
  const leadgenId = value.leadgen_id;
  const isTest = value.is_test === true;

  // ── Idempotency: dedupe on Meta's globally-unique leadgen_id ──────────────
  const existing = await db.lead.findFirst({
    where: { orgId, customFields: { path: ["leadgenId"], equals: leadgenId } },
    select: { id: true, name: true, courseInterest: true, status: true },
  });
  if (existing) {
    if (!isTest && existing.status !== "TEST_LEAD") {
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
    log({ event: "facebook_leadgen_replayed", leadgenId, leadId: existing.id, timestamp: now().toISOString() });
    return { kind: "replayed", leadId: existing.id, test: isTest };
  }

  // ── Intake gate (production leads only) ────────────────────────────────────
  const settings = orgSettings as Record<string, unknown> | null;
  if (!isTest && settings?.applicationIntake === false) {
    log({ event: "facebook_leadgen_skipped", reason: "intake_closed", leadgenId, timestamp: now().toISOString() });
    return { kind: "skipped_no_phone" };
  }

  // ── Lead data comes from Graph (notification carries only the leadgen_id) ──
  if (!pageAccessToken) {
    log({ event: "facebook_leadgen_not_configured", reason: "no_graph_credentials", leadgenId, timestamp: now().toISOString() });
    return { kind: "not_configured" };
  }

  let graph: { ok: boolean; status: number; json: unknown };
  try {
    graph = await deps.fetchGraph(leadgenId, pageAccessToken, appSecret);
  } catch (err) {
    log({ event: "facebook_leadgen_provider_error", reason: "graph_fetch_failed", leadgenId, timestamp: now().toISOString() });
    return { kind: "provider_error", reason: "graph_fetch_failed" };
  }
  if (!graph.ok) {
    log({
      event: "facebook_leadgen_provider_error",
      reason: "graph_fetch_failed",
      httpStatus: graph.status,
      leadgenId,
      timestamp: now().toISOString(),
    });
    return { kind: "provider_error", reason: "graph_fetch_failed" };
  }
  const leadData = graph.json as MetaLeadGenGraphLead | null;
  const fields = Array.isArray(leadData?.field_data) ? leadData.field_data : [];
  if (leadData?.id !== leadgenId) {
    log({ event: "facebook_leadgen_provider_error", reason: "graph_empty", leadgenId, timestamp: now().toISOString() });
    return { kind: "provider_error", reason: "graph_empty" };
  }

  const phone = phoneFrom(fields);
  if (!phone) {
    log({ event: "facebook_leadgen_skipped", reason: "no_phone", leadgenId, timestamp: now().toISOString() });
    return { kind: "skipped_no_phone" };
  }
  const normalizedPhone = phone.replace(/\s+/g, "").trim();
  const name = nameFrom(fields);
  const email = emailFrom(fields);
  const courseInterest = courseFrom(fields);

  const customFields: Prisma.InputJsonValue = {
    leadgenId,
    leadgenFormId: iso(value.form_id),
    leadgenPageId: iso(value.page_id),
    leadgenCreatedTime: iso(value.created_time),
    leadgenCampaignId: iso(leadData.campaign_id),
    facebookTestLead: isTest,
    webSource: "facebook_lead_form",
    leadgenRawGraph: leadData as unknown as Prisma.InputJsonValue,
  };

  // Same person in another phone format (+91 / spaces / leading 0), or a lead
  // sitting in the Recycle Bin: converge on it instead of creating a duplicate.
  const samePerson = await db.lead.findFirst({
    where: { orgId, phone: { in: contactCandidates(normalizedPhone) } },
    select: { id: true, name: true, courseInterest: true, status: true, deletedAt: true },
  });
  if (samePerson) {
    const existing = samePerson;
    if (existing.deletedAt) {
      await db.$transaction(async (tx) => {
        await tx.lead.update({ where: { id: existing.id }, data: { deletedAt: null, lastActivityAt: now() } });
        await tx.leadActivity.create({
          data: {
            leadId: existing.id,
            orgId,
            activityType: "NOTE",
            title: "Restored from Recycle Bin",
            notes: `New Facebook Lead Ads submission (Form ID: ${value.form_id ?? "unknown"}) for this phone.`,
            completedAt: now(),
            metadata: { source: SOURCE, leadgenId, restoredFromTrash: true },
          },
        });
      });
      log({ event: "facebook_leadgen_restored", leadgenId, leadId: existing.id, timestamp: now().toISOString() });
    }
    if (!isTest && existing.status !== "TEST_LEAD") {
      await deps.emitLeadCreated({
        orgId,
        leadId: existing.id,
        leadName: existing.name,
        source: SOURCE,
        courseInterest: existing.courseInterest ?? courseInterest,
        actorName: ACTOR_NAME,
        ipAddress: IP_ADDRESS,
      });
    }
    log({ event: "facebook_leadgen_duplicate", leadgenId, leadId: existing.id, timestamp: now().toISOString() });
    return { kind: "duplicate", leadId: existing.id, test: isTest };
  }

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
          utmSource: "facebook",
          utmMedium: "ad",
          utmCampaign: iso(leadData.campaign_id) ?? iso(value.form_id),
          customFields,
        },
        select: { id: true, name: true, createdAt: true },
      });

      await tx.leadActivity.create({
        data: {
          leadId: created.id,
          orgId,
          activityType: "NOTE",
          title: isTest ? "Facebook Ads Test Lead" : "Facebook Lead Form",
          notes: `Lead received via Facebook Lead Ads (Form ID: ${value.form_id ?? "unknown"}${
            isTest ? " — synthetic test data" : ""
          })`,
          completedAt: now(),
          metadata: {
            source: SOURCE,
            leadgenId,
            formId: value.form_id,
            pageId: value.page_id,
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
      typeof err === "object" && err !== null && "code" in err && (err as { code?: string }).code === "P2002";
    if (isP2002) {
      // unique(orgId, phone) — a lead already exists for this phone; converge.
      const raced = await db.lead.findFirst({
        where: { orgId, phone: normalizedPhone },
        select: { id: true, name: true, courseInterest: true, status: true },
      });
      if (raced) {
        if (!isTest && raced.status !== "TEST_LEAD") {
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
        log({ event: "facebook_leadgen_duplicate", leadgenId, leadId: raced.id, timestamp: now().toISOString() });
        return { kind: "duplicate", leadId: raced.id, test: isTest };
      }
    }
    throw err;
  }

  log({ event: "facebook_leadgen_saved", leadId: lead.id, leadgenId, test: isTest, timestamp: now().toISOString() });

  // ── Audit + activity feed + canonical lead.created (real leads only) ───────
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