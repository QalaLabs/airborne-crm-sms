import test from "node:test";
import assert from "node:assert/strict";
import {
  processGoogleAdsLead,
  isGoogleAdsKeyValid,
  orgWebhookKey,
  isTestLeadRow,
  type GoogleAdsWebhookDb,
  type GoogleAdsWebhookDeps,
  type GoogleAdsWebhookPayload,
} from "./google-ads.service";

const ORG = "org-1";
const NOW = new Date("2026-09-02T08:00:00.000Z");

interface FakeLead {
  orgId: string;
  id: string;
  name: string;
  email: string | null;
  phone: string;
  courseInterest: string | null;
  status: string;
  createdAt: Date;
  customFields: Record<string, unknown>;
}

function matches(where: Record<string, unknown>, row: FakeLead): boolean {
  if (where.orgId !== undefined && row.orgId !== where.orgId) return false;
  if (where.phone !== undefined && row.phone !== String(where.phone)) return false;
  const cf = where.customFields as
    | { path?: string[]; equals?: unknown }
    | undefined;
  if (cf?.path && cf.path.length === 1 && "equals" in cf) {
    const key = cf.path[0] as string;
    if (row.customFields[key] !== cf.equals) return false;
  }
  return true;
}

function makeDb() {
  const leads: FakeLead[] = [];
  const activities: unknown[] = [];
  let seq = 0;

  const tx = {
    lead: {
      create: async (args: {
        data: Partial<FakeLead> & { orgId: string; phone: string };
        select?: Record<string, boolean>;
      }) => {
        const data = args.data;
        if (leads.some((r) => r.orgId === data.orgId && r.phone === data.phone)) {
          const err = new Error("Unique constraint failed") as Error & {
            code?: string;
          };
          err.code = "P2002";
          throw err;
        }
        seq += 1;
        const row: FakeLead = {
          orgId: data.orgId,
          id: `lead-${seq}`,
          name: data.name ?? "",
          email: data.email ?? null,
          phone: data.phone,
          courseInterest: data.courseInterest ?? null,
          status: data.status ?? "NEW",
          createdAt: NOW,
          customFields: (data.customFields ?? {}) as Record<string, unknown>,
        };
        leads.push(row);
        return { id: row.id, name: row.name, createdAt: row.createdAt };
      },
      update: async (args: { where: { id: string }; data: Record<string, unknown> }) => {
        const row = leads.find((l) => l.id === args.where.id);
        return row ?? null;
      },
    },
    leadActivity: {
      create: async (args: unknown) => {
        activities.push(args);
        return { id: `activity-${leads.length}-${activities.length}` };
      },
    },
  };

  return {
    db: {
      lead: {
        findFirst: async (args: { where: Record<string, unknown> }) =>
          leads.find((r) => matches(args.where, r)) ?? null,
      },
      leadActivity: { create: async () => ({ id: "activity-x" }) },
      $transaction: async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx),
    } as unknown as GoogleAdsWebhookDb,
    leads,
    activities,
    tx,
  };
}

function makeDeps(db: GoogleAdsWebhookDb) {
  const emitted: Array<Parameters<NonNullable<GoogleAdsWebhookDeps["emitLeadCreated"]>>[0]> = [];
  const audits: Array<Record<string, unknown>> = [];
  const feed: Array<Record<string, unknown>> = [];
  const logs: Array<Record<string, unknown>> = [];
  const deps: GoogleAdsWebhookDeps = {
    db,
    emitLeadCreated: async (input) => {
      emitted.push(input);
    },
    writeAudit: async (input) => {
      audits.push(input);
    },
    writeActivityFeed: async (input) => {
      feed.push(input);
    },
    log: (line) => logs.push(line),
    now: () => NOW,
  };
  return { deps, emitted, audits, feed, logs };
}

function kit(payload: GoogleAdsWebhookPayload, orgSettings: unknown = null) {
  const k = makeDb();
  const d = makeDeps(k.db);
  const p = processGoogleAdsLead({
    orgId: ORG,
    orgSettings,
    payload,
    deps: d.deps,
  });
  return { ...k, ...d, result: p };
}

const validPayload: GoogleAdsWebhookPayload = {
  lead_id: `Cj0KCQjwit_8BR${"CoARIs"}`,
  api_version: "1.0",
  form_id: 1234,
  campaign_id: 654321,
  adgroup_id: 555,
  creative_id: 777,
  asset_group_id: 888,
  gcl_id: "Cj0KCQjwit_8BRCoARIsAIx3Rj7g",
  lead_stage: "LEAD",
  lead_submit_time: "2026-09-02T07:30:00Z",
  lead_source: "LEAD_FORM",
  google_key: "secret",
  is_test: false,
  user_column_data: [
    { column_id: "FULL_NAME", string_value: "John Doe" },
    { column_id: "EMAIL", string_value: "john.doe@example.com" },
    { column_id: "PHONE_NUMBER", string_value: "+91 98765 43210" },
    { column_id: "EDUCATION_COURSE", string_value: "DGCA CPL Ground School" },
  ],
};

// ─── Authentication ──────────────────────────────────────────────────────────

test("webhook key: valid key accepted (single and dual sources)", () => {
  assert.equal(isGoogleAdsKeyValid("secret", "secret"), true);
  assert.equal(isGoogleAdsKeyValid("k2", "k1", "k2"), true);
  assert.equal(isGoogleAdsKeyValid("k2", null, "k2"), true);
});

test("webhook key: wrong key rejected", () => {
  assert.equal(isGoogleAdsKeyValid("wrong", "secret"), false);
  assert.equal(isGoogleAdsKeyValid("wrong", "s1", "s2"), false);
});

test("webhook key: missing key rejected", () => {
  assert.equal(isGoogleAdsKeyValid(undefined, "secret"), false);
  assert.equal(isGoogleAdsKeyValid("", "secret"), false);
});

test("webhook key: length mismatch never throws", () => {
  assert.equal(isGoogleAdsKeyValid("short", "a-much-longer-secret"), false);
  assert.equal(isGoogleAdsKeyValid("a-much-longer-secret", "short"), false);
});

test("org key extraction reads settings.googleAdsWebhookSecret only when string", () => {
  assert.equal(orgWebhookKey({ googleAdsWebhookSecret: " abc " }), "abc");
  assert.equal(orgWebhookKey({ googleAdsWebhookSecret: 42 }), null);
  assert.equal(orgWebhookKey({}), null);
  assert.equal(orgWebhookKey(null), null);
});

// ─── Payload validation ──────────────────────────────────────────────────────

test("bad request: missing lead_id is rejected", async () => {
  const k = makeDb();
  const d = makeDeps(k.db);
  const result = await processGoogleAdsLead({
    orgId: ORG,
    orgSettings: null,
    payload: { user_column_data: [{ column_id: "PHONE_NUMBER", string_value: "91987" }] },
    deps: d.deps,
  });
  assert.deepEqual(result, { kind: "bad_request", reason: "missing_lead_id" });
  assert.equal(k.leads.length, 0);
});

test("bad request: user_column_data must be an array if present", async () => {
  const k = makeDb();
  const d = makeDeps(k.db);
  const result1 = await processGoogleAdsLead({
    orgId: ORG,
    orgSettings: null,
    payload: { lead_id: "L1", user_column_data: {} as never },
    deps: d.deps,
  });
  const result2 = await processGoogleAdsLead({
    orgId: ORG,
    orgSettings: null,
    payload: { lead_id: "L1", user_column_data: "nope" as never },
    deps: d.deps,
  });
  assert.deepEqual(result1, { kind: "bad_request", reason: "invalid_user_column_data" });
  assert.deepEqual(result2, { kind: "bad_request", reason: "invalid_user_column_data" });
  assert.equal(k.leads.length, 0);
});

test("skipped: payload without PHONE_NUMBER is acknowledged, not persisted", async () => {
  const k = makeDb();
  const d = makeDeps(k.db);
  const result = await processGoogleAdsLead({
    orgId: ORG,
    orgSettings: null,
    payload: {
      lead_id: "L-nophone",
      user_column_data: [{ column_id: "EMAIL", string_value: "a@b.com" }],
    },
    deps: d.deps,
  });
  assert.deepEqual(result, { kind: "skipped_no_phone" });
  assert.equal(k.leads.length, 0);
  assert.equal(d.emitted.length, 0);
  assert.equal(d.audits.length, 0);
});

// ─── Field mapping ───────────────────────────────────────────────────────────

test("valid production payload maps name/email/phone/course/campaign/gclid + metadata", async () => {
  const k = makeDb();
  const d = makeDeps(k.db);
  const result = await processGoogleAdsLead({
    orgId: ORG,
    orgSettings: null,
    payload: validPayload,
    deps: d.deps,
  });

  assert.equal(result.kind, "created");
  assert.equal(k.leads.length, 1);
  const row = k.leads[0];
  assert.ok(row);
  assert.equal(row.name, "John Doe");
  assert.equal(row.email, "john.doe@example.com");
  assert.equal(row.phone, "+919876543210"); // whitespace stripped
  assert.equal(row.courseInterest, "DGCA CPL Ground School"); // EDUCATION_COURSE mapped
  assert.equal(row.status, "NEW"); // real lead keeps default status
  assert.equal(row.customFields.googleAdsLeadId, validPayload.lead_id);
  assert.equal(row.customFields.googleAdsCampaignId, "654321");
  assert.equal(row.customFields.googleAdsFormId, "1234");
  assert.equal(row.customFields.googleAdsAdgroupId, "555");
  assert.equal(row.customFields.googleAdsCreativeId, "777");
  assert.equal(row.customFields.googleAdsAssetGroupId, "888");
  assert.equal(row.customFields.googleAdsLeadStage, "LEAD");
  assert.equal(row.customFields.googleAdsLeadSubmitTime, "2026-09-02T07:30:00Z");
  assert.equal(row.customFields.googleAdsLeadSource, "LEAD_FORM");
  assert.equal(row.customFields.gclId, "Cj0KCQjwit_8BRCoARIsAIx3Rj7g");
  assert.equal(row.customFields.webSource, "google_ads_lead_form");
});

test("first+last name and empty FULL_NAME fall back to FIRST_NAME + LAST_NAME", async () => {
  const k = makeDb();
  const d = makeDeps(k.db);
  const result = await processGoogleAdsLead({
    orgId: ORG,
    orgSettings: null,
    payload: {
      lead_id: "L-name",
      user_column_data: [
        { column_id: "FIRST_NAME", string_value: "Mary" },
        { column_id: "LAST_NAME", string_value: "Jane" },
        { column_id: "PHONE_NUMBER", string_value: "+919876543210" },
      ],
    },
    deps: d.deps,
  });
  assert.equal(result.kind, "created");
  assert.equal(k.leads[0]?.name, "Mary Jane");
});

// ─── Downstream event emission ───────────────────────────────────────────────

test("created lead emits lead.created via canonical pipeline with attribution", async () => {
  const k = makeDb();
  const d = makeDeps(k.db);
  await processGoogleAdsLead({
    orgId: ORG,
    orgSettings: null,
    payload: validPayload,
    deps: d.deps,
  });
  assert.equal(d.emitted.length, 1);
  const ev = d.emitted[0];
  assert.ok(ev);
  assert.equal(ev.leadId, k.leads[0]?.id);
  assert.equal(ev.source, "GOOGLE_ADS");
  assert.equal(ev.courseInterest, "DGCA CPL Ground School");
  assert.equal(ev.actorName, "Google Ads Lead Form");
  assert.equal(d.audits.length, 1);
  assert.equal(d.feed.length, 1);
});

test("downstream failure is observable but never un-persists the lead (retryable)", async () => {
  const k = makeDb();
  const d = makeDeps(k.db);
  const emitStatuses: string[] = [];
  let fail = true;

  // emitLeadCreated in the real pipeline swallows provider errors (records them
  // on internal_events.lastError/failedAt and retries via cron). Mirror that.
  d.deps.emitLeadCreated = async () => {
    try {
      if (fail) {
        fail = false;
        throw new Error("Interakt API timeout");
      }
      emitStatuses.push("ok");
    } catch (err) {
      emitStatuses.push("failed:" + (err instanceof Error ? err.message : "unknown"));
    }
  };

  const first = await processGoogleAdsLead({
    orgId: ORG,
    orgSettings: null,
    payload: validPayload,
    deps: d.deps,
  });

  // Lead is committed and HTTP-visible; a throttled WhatsApp never blocks it.
  assert.equal(first.kind, "created");
  assert.equal(k.leads.length, 1);
  assert.deepEqual(emitStatuses, ["failed:Interakt API timeout"]);

  // Google retry converges on the same row — no duplicates.
  const retry = await processGoogleAdsLead({
    orgId: ORG,
    orgSettings: null,
    payload: validPayload,
    deps: d.deps,
  });
  assert.equal(retry.kind, "replayed");
  assert.equal(k.leads.length, 1);
  assert.deepEqual(emitStatuses, ["failed:Interakt API timeout", "ok"]);
});

// ─── Test leads ("Send test data") ───────────────────────────────────────────

test("test payload is persisted as TEST_LEAD but never enters automation", async () => {
  const k = makeDb();
  const d = makeDeps(k.db);
  const result = await processGoogleAdsLead({
    orgId: ORG,
    orgSettings: null,
    payload: { ...validPayload, lead_id: "test-lead-1", is_test: true },
    deps: d.deps,
  });
  assert.deepEqual(result, { kind: "created", leadId: k.leads[0]?.id, test: true });
  assert.equal(k.leads.length, 1);
  const row = k.leads[0];
  assert.ok(row);
  assert.equal(row.status, "TEST_LEAD");
  assert.equal(row.customFields.googleAdsTestLead, true);
  assert.equal(d.emitted.length, 0, "no WhatsApp/Interakt for synthetic test data");
  assert.equal(d.audits.length, 0);
});

test("test payload is persisted even when application intake is closed", async () => {
  const k = makeDb();
  const d = makeDeps(k.db);
  const result = await processGoogleAdsLead({
    orgId: ORG,
    orgSettings: { applicationIntake: false },
    payload: { ...validPayload, lead_id: "test-lead-2", is_test: true },
    deps: d.deps,
  });
  assert.equal(result.kind, "created");
  assert.equal(k.leads.length, 1);
});

test("real payload when intake is closed is acknowledged and dropped", async () => {
  const k = makeDb();
  const d = makeDeps(k.db);
  const result = await processGoogleAdsLead({
    orgId: ORG,
    orgSettings: { applicationIntake: false },
    payload: { ...validPayload, lead_id: "real-lead-closed" },
    deps: d.deps,
  });
  assert.deepEqual(result, { kind: "skipped_intake_closed" });
  assert.equal(k.leads.length, 0);
  assert.equal(d.emitted.length, 0);
});

// ─── Idempotency / retries ───────────────────────────────────────────────────

test("retry of same lead_id is idempotent (replayed, no duplicate row)", async () => {
  const k = makeDb();
  const d = makeDeps(k.db);
  const first = await processGoogleAdsLead({ orgId: ORG, orgSettings: null, payload: validPayload, deps: d.deps });
  assert.equal(first.kind, "created");
  const second = await processGoogleAdsLead({ orgId: ORG, orgSettings: null, payload: validPayload, deps: d.deps });
  assert.deepEqual(second, { kind: "replayed", leadId: k.leads[0]?.id, test: false });
  assert.equal(k.leads.length, 1, "no duplicate DB rows on retry");
  assert.equal(d.emitted.length, 2, "replay re-emits but InternalEvent dedupes processing");
});

test("concurrent same-phone race converges via unique(orgId, phone) P2002", async () => {
  const k2 = makeDb();
  const d2 = makeDeps(k2.db);
  await processGoogleAdsLead({
    orgId: ORG,
    orgSettings: null,
    payload: {
      lead_id: "existing-phone",
      user_column_data: [
        { column_id: "FULL_NAME", string_value: "Smith" },
        { column_id: "PHONE_NUMBER", string_value: "+919876543210" },
      ],
    },
    deps: d2.deps,
  });
  assert.equal(k2.leads.length, 1);

  const result = await processGoogleAdsLead({
    orgId: ORG,
    orgSettings: null,
    payload: {
      lead_id: "google-race-new-id",
      user_column_data: [
        { column_id: "FULL_NAME", string_value: "Smith" },
        { column_id: "PHONE_NUMBER", string_value: "+91 98765 43210" },
      ],
    },
    deps: d2.deps,
  });
  assert.equal(result.kind, "duplicate");
  assert.equal(k2.leads.length, 1, "P2002 path never creates a second row");
  assert.equal(d2.emitted.length, 2, "duplicate path re-emits canonical event");
});

test("test lead replay does not emit automation", async () => {
  const k = makeDb();
  const d = makeDeps(k.db);
  const first = await processGoogleAdsLead({
    orgId: ORG,
    orgSettings: null,
    payload: { ...validPayload, lead_id: "test-replay", is_test: true },
    deps: d.deps,
  });
  assert.equal(first.kind, "created");
  const second = await processGoogleAdsLead({
    orgId: ORG,
    orgSettings: null,
    payload: { ...validPayload, lead_id: "test-replay", is_test: true },
    deps: d.deps,
  });
  assert.deepEqual(second, { kind: "replayed", leadId: k.leads[0]?.id, test: true });
  assert.equal(k.leads.length, 1);
  assert.equal(d.emitted.length, 0, "no automation for test data, retried or not");
});

test("isTestLeadRow detects TEST_LEAD status and custom field marker", () => {
  assert.equal(isTestLeadRow({ status: "TEST_LEAD" }), true);
  assert.equal(isTestLeadRow({ status: "NEW", customFields: { googleAdsTestLead: true } }), true);
  assert.equal(isTestLeadRow({ status: "NEW", customFields: {} }), false);
});

// ─── Course routing feed ─────────────────────────────────────────────────────

test("cabin crew Google lead maps to cabin_crew via canonical course-routing", async () => {
  const k = makeDb();
  const d = makeDeps(k.db);
  const payload: GoogleAdsWebhookPayload = {
    lead_id: "google-cabin",
    campaign_id: 11,
    user_column_data: [
      { column_id: "FULL_NAME", string_value: "Cabin Prospect" },
      { column_id: "PHONE_NUMBER", string_value: "+919876543211" },
      { column_id: "EDUCATION_PROGRAM", string_value: "Cabin Crew Training" },
    ],
  };
  await processGoogleAdsLead({ orgId: ORG, orgSettings: null, payload, deps: d.deps });
  const row = k.leads[0];
  assert.equal(row?.courseInterest, "Cabin Crew Training");
  const ev = d.emitted[0];
  assert.ok(ev);
  assert.equal(ev.courseInterest, "Cabin Crew Training");
  // canonical course-routing (lib/messaging/providers/interakt/course-routing.ts)
  // maps "Cabin Crew Training" → cabin_crew; the mapping.ts test covers the traits.
  const { normalizeCourseKey } = await import("@/lib/messaging/providers/interakt/course-routing");
  assert.equal(normalizeCourseKey(row?.courseInterest), "cabin_crew");
});