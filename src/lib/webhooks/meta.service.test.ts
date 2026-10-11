import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import {
  verifyMetaSignature,
  hubChallengeMatches,
  processMetaLeadGen,
  processMetaLeadGenBatch,
  type MetaWebhookDb,
  type MetaWebhookDeps,
  type MetaWebhookPayload,
  type MetaLeadGenGraphLead,
} from "./meta.service";

const ORG = "org-1";
const NOW = new Date("2026-09-02T08:00:00.000Z");
const APP_SECRET = "app_secret_abc";
const PAGE_TOKEN = "page_token_xyz";

interface FakeLead {
  orgId: string;
  id: string;
  name: string;
  email: string | null;
  phone: string;
  courseInterest: string | null;
  status: string;
  source?: string;
  createdAt: Date;
  customFields: Record<string, unknown>;
  deletedAt?: Date | null;
}

function matches(where: Record<string, unknown>, row: FakeLead): boolean {
  if (where.orgId !== undefined && row.orgId !== where.orgId) return false;
  if (where.phone !== undefined) {
    const p = where.phone as string | { in?: string[] };
    if (typeof p === "object" && p !== null && Array.isArray(p.in)) {
      if (!p.in.includes(row.phone)) return false;
    } else if (row.phone !== String(p)) return false;
  }
  const cf = where.customFields as { path?: string[]; equals?: unknown } | undefined;
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
          const err = new Error("Unique constraint failed") as Error & { code?: string };
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
          source: data.source,
          createdAt: NOW,
          customFields: (data.customFields ?? {}) as Record<string, unknown>,
        };
        leads.push(row);
        return { id: row.id, name: row.name, createdAt: row.createdAt };
      },
      update: async (args: { where: { id: string }; data: Record<string, unknown> }) => {
        const row = leads.find((l) => l.id === args.where.id);
        if (row && "deletedAt" in args.data) row.deletedAt = args.data.deletedAt as Date | null;
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
    } as unknown as MetaWebhookDb,
    leads,
    activities,
    tx,
  };
}

const graphLead: MetaLeadGenGraphLead = {
  id: "LGN-001",
  created_time: "2026-09-02T07:00:00+0000",
  campaign_id: "7654321",
  is_test: false,
  field_data: [
    { name: "full_name", values: ["Jane Foster"] },
    { name: "email", values: ["jane.foster@example.com"] },
    { name: "phone_number", values: ["+91 99887 76655"] },
    { name: "course_interest", values: ["CPL (Commercial Pilot License)"] },
  ],
};

function graphOk(fields?: MetaLeadGenGraphLead["field_data"]) {
  return async (requestedId: string) => ({
    ok: true,
    status: 200,
    json: {
      ...graphLead,
      id: requestedId,
      ...(fields ? { field_data: fields } : {}),
    },
  });
}

function makeDeps(db: MetaWebhookDb, fetchGraph: MetaWebhookDeps["fetchGraph"] = graphOk()) {
  const emitted: Array<Parameters<NonNullable<MetaWebhookDeps["emitLeadCreated"]>>[0]> = [];
  const audits: Array<Record<string, unknown>> = [];
  const feed: Array<Record<string, unknown>> = [];
  const logs: Array<Record<string, unknown>> = [];
  const deps: MetaWebhookDeps = {
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
    fetchGraph,
    log: (line) => logs.push(line),
    now: () => NOW,
  };
  return { deps, emitted, audits, feed, logs };
}

const validPayload: MetaWebhookPayload = {
  object: "page",
  entry: [
    {
      id: "page-1",
      changes: [
        {
          field: "leadgen",
          value: { leadgen_id: "LGN-001", page_id: "page-1", form_id: "form-9", created_time: 1756800000 },
        },
      ],
    },
  ],
};

// ─── Signature verification ──────────────────────────────────────────────────

test("meta signature: matching HMAC-SHA256 accepted, wrong secret rejected", () => {
  const raw = JSON.stringify(validPayload);
  const sig = `sha256=${createHmac("sha256", APP_SECRET).update(raw, "utf8").digest("hex")}`;
  assert.equal(verifyMetaSignature(APP_SECRET, sig, raw), true);
  assert.equal(verifyMetaSignature("other-secret", sig, raw), false);
});

test("meta signature: malformed / missing header rejected without throwing", () => {
  const raw = JSON.stringify(validPayload);
  assert.equal(verifyMetaSignature(APP_SECRET, undefined, raw), false);
  assert.equal(verifyMetaSignature(APP_SECRET, "md5=abcdef", raw), false);
  assert.equal(verifyMetaSignature(APP_SECRET, "sha256=tooshort", raw), false);
  assert.equal(verifyMetaSignature(undefined, "sha256=abc", raw), false);
});

test("hub challenge: echoes only when mode=subscribe and token matches", () => {
  assert.equal(hubChallengeMatches("subscribe", "tok", "tok"), true);
  assert.equal(hubChallengeMatches("subscribe", "tok", undefined), false);
  assert.equal(hubChallengeMatches("subscribe", null, "tok"), false);
  assert.equal(hubChallengeMatches("subscribe", "wrong", "tok"), false);
  assert.equal(hubChallengeMatches("unsubscribe", "tok", "tok"), false);
});

// ─── Payload validation ──────────────────────────────────────────────────────

test("bad request: missing leadgen_id / empty entry rejected", async () => {
  const k = makeDb();
  const d = makeDeps(k.db);
  const r1 = await processMetaLeadGen({
    orgId: ORG, orgSettings: null, appSecret: APP_SECRET, pageAccessToken: PAGE_TOKEN,
    payload: { object: "page", entry: [] }, deps: d.deps,
  });
  const r2 = await processMetaLeadGen({
    orgId: ORG, orgSettings: null, appSecret: APP_SECRET, pageAccessToken: PAGE_TOKEN,
    payload: { object: "page", entry: [{ changes: [{ field: "budget" }] }] }, deps: d.deps,
  });
  assert.deepEqual(r1, { kind: "bad_request", reason: "missing_leadgen_id" });
  assert.deepEqual(r2, { kind: "bad_request", reason: "missing_leadgen_id" });
  assert.equal(k.leads.length, 0);
});

test("not configured: absent app secret short-circuits before any DB work", async () => {
  const k = makeDb();
  const d = makeDeps(k.db);
  const r = await processMetaLeadGen({
    orgId: ORG, orgSettings: null, appSecret: undefined, pageAccessToken: PAGE_TOKEN,
    payload: validPayload, deps: d.deps,
  });
  assert.deepEqual(r, { kind: "not_configured" });
  assert.equal(k.leads.length, 0);
  assert.equal(d.emitted.length, 0);
});

test("not configured: absent page token returns not_configured after dedup check", async () => {
  const k = makeDb();
  const d = makeDeps(k.db);
  const r = await processMetaLeadGen({
    orgId: ORG, orgSettings: null, appSecret: APP_SECRET, pageAccessToken: undefined,
    payload: validPayload, deps: d.deps,
  });
  assert.equal(r.kind, "not_configured");
  assert.equal(k.leads.length, 0);
});

test("provider error: Graph fetch throw is not swallowed as a bad lead", async () => {
  const k = makeDb();
  const d = makeDeps(k.db, async () => {
    throw new Error("network");
  });
  const r = await processMetaLeadGen({
    orgId: ORG, orgSettings: null, appSecret: APP_SECRET, pageAccessToken: PAGE_TOKEN,
    payload: validPayload, deps: d.deps,
  });
  assert.deepEqual(r, { kind: "provider_error", reason: "graph_fetch_failed" });
  assert.equal(k.leads.length, 0);
});

test("provider error: Graph non-2xx is a retryable provider error", async () => {
  const k = makeDb();
  const d = makeDeps(k.db, async () => ({ ok: false, status: 400, json: { error: { message: "Invalid OAuth token" } } }));
  const r = await processMetaLeadGen({
    orgId: ORG, orgSettings: null, appSecret: APP_SECRET, pageAccessToken: PAGE_TOKEN,
    payload: validPayload, deps: d.deps,
  });
  assert.equal(r.kind, "provider_error");
  assert.equal(k.leads.length, 0);
});

test("provider error: Graph mismatch (id not leadgen_id) treated as empty", async () => {
  const k = makeDb();
  const d = makeDeps(k.db, async () => ({ ok: true, status: 200, json: { id: "OTHER" } }));
  const r = await processMetaLeadGen({
    orgId: ORG, orgSettings: null, appSecret: APP_SECRET, pageAccessToken: PAGE_TOKEN,
    payload: validPayload, deps: d.deps,
  });
  assert.deepEqual(r, { kind: "provider_error", reason: "graph_empty" });
});

test("skipped: no phone in field_data is acknowledged, not persisted", async () => {
  const k = makeDb();
  const d = makeDeps(
    k.db,
    graphOk([
      { name: "full_name", values: ["NoPhone"] },
    ]),
  );
  const r = await processMetaLeadGen({
    orgId: ORG, orgSettings: null, appSecret: APP_SECRET, pageAccessToken: PAGE_TOKEN,
    payload: validPayload, deps: d.deps,
  });
  assert.deepEqual(r, { kind: "skipped_no_phone" });
  assert.equal(k.leads.length, 0);
});

// ─── Happy path ──────────────────────────────────────────────────────────────

test("valid leadgen maps fields + metadata and emits canonical event", async () => {
  const k = makeDb();
  const d = makeDeps(k.db);
  const r = await processMetaLeadGen({
    orgId: ORG, orgSettings: null, appSecret: APP_SECRET, pageAccessToken: PAGE_TOKEN,
    payload: validPayload, deps: d.deps,
  });
  assert.equal(r.kind, "created");
  assert.equal(k.leads.length, 1);
  const row = k.leads[0];
  assert.ok(row);
  assert.equal(row.name, "Jane Foster");
  assert.equal(row.email, "jane.foster@example.com");
  assert.equal(row.phone, "+919988776655");
  assert.equal(row.courseInterest, "CPL (Commercial Pilot License)");
  assert.equal(row.source, "FACEBOOK_ADS");
  assert.equal(row.status, "NEW");
  assert.equal(row.customFields.leadgenId, "LGN-001");
  assert.equal(row.customFields.leadgenFormId, "form-9");
  assert.equal(row.customFields.leadgenCampaignId, "7654321");
  assert.equal(row.customFields.webSource, "facebook_lead_form");
  assert.equal(d.emitted.length, 1);
  const ev = d.emitted[0];
  assert.ok(ev);
  assert.equal(ev.source, "FACEBOOK_ADS");
  assert.equal(ev.actorName, "Facebook Lead Ads");
  assert.equal(d.audits.length, 1);
  assert.equal(d.feed.length, 1);
});

test("field_data keys are matched case-insensitively (FIRST_NAME/LAST_NAME)", async () => {
  const k = makeDb();
  const d = makeDeps(
    k.db,
    graphOk([
      { name: "first_name", values: ["Mary"] },
      { name: "last_name", values: ["Jane"] },
      { name: "phone_number", values: ["919876543210"] },
    ]),
  );
  const r = await processMetaLeadGen({
    orgId: ORG, orgSettings: null, appSecret: APP_SECRET, pageAccessToken: PAGE_TOKEN,
    payload: validPayload, deps: d.deps,
  });
  assert.equal(r.kind, "created");
  assert.equal(k.leads[0]?.name, "Mary Jane");
});

// ─── Test flags & intake gate ────────────────────────────────────────────────

test("is_test leadgen persists TEST_LEAD but never enters automation", async () => {
  const k = makeDb();
  const d = makeDeps(k.db);
  const testPayload: MetaWebhookPayload = {
    entry: [
      {
        changes: [
          { field: "leadgen", value: { leadgen_id: "LGN-TEST", is_test: true } },
        ],
      },
    ],
  };
  const r = await processMetaLeadGen({
    orgId: ORG, orgSettings: null, appSecret: APP_SECRET, pageAccessToken: PAGE_TOKEN,
    payload: testPayload, deps: d.deps,
  });
  assert.equal(r.kind, "created");
  assert.equal(k.leads[0]?.status, "TEST_LEAD");
  assert.equal(k.leads[0]?.customFields.leadgenId, "LGN-TEST");
  assert.equal(d.emitted.length, 0, "no automation for synthetic test data");
  assert.equal(d.audits.length, 0);
});

test("real lead when intake closed is acknowledged and dropped; test still saved", async () => {
  const k = makeDb();
  const d = makeDeps(k.db);
  const r = await processMetaLeadGen({
    orgId: ORG, orgSettings: { applicationIntake: false }, appSecret: APP_SECRET, pageAccessToken: PAGE_TOKEN,
    payload: { ...validPayload, entry: [{ changes: [{ field: "leadgen", value: { leadgen_id: "LGN-CLOSED" } }] }] },
    deps: d.deps,
  });
  assert.equal(r.kind, "skipped_no_phone");

  const k2 = makeDb();
  const d2 = makeDeps(k2.db);
  const r2 = await processMetaLeadGen({
    orgId: ORG, orgSettings: { applicationIntake: false }, appSecret: APP_SECRET, pageAccessToken: PAGE_TOKEN,
    payload: { entry: [{ changes: [{ field: "leadgen", value: { leadgen_id: "LGN-TEST2", is_test: true } }] }] },
    deps: d2.deps,
  });
  assert.equal(r2.kind, "created");
  assert.equal(k2.leads.length, 1);
});

// ─── Idempotency / retries ───────────────────────────────────────────────────

test("retry of same leadgen_id is idempotent (replayed, no duplicate)", async () => {
  const k = makeDb();
  const d = makeDeps(k.db);
  const first = await processMetaLeadGen({
    orgId: ORG, orgSettings: null, appSecret: APP_SECRET, pageAccessToken: PAGE_TOKEN,
    payload: validPayload, deps: d.deps,
  });
  assert.equal(first.kind, "created");
  const second = await processMetaLeadGen({
    orgId: ORG, orgSettings: null, appSecret: APP_SECRET, pageAccessToken: PAGE_TOKEN,
    payload: validPayload, deps: d.deps,
  });
  assert.deepEqual(second, { kind: "replayed", leadId: k.leads[0]?.id, test: false });
  assert.equal(k.leads.length, 1);
  assert.equal(d.emitted.length, 2, "replay re-emits but InternalEvent dedupes processing");
});

test("same-phone race converges via unique(orgId, phone) P2002 path", async () => {
  const k = makeDb();
  const d = makeDeps(k.db);
  await processMetaLeadGen({
    orgId: ORG, orgSettings: null, appSecret: APP_SECRET, pageAccessToken: PAGE_TOKEN,
    payload: { entry: [{ changes: [{ field: "leadgen", value: { leadgen_id: "LGN-RACE" } }] }] },
    deps: d.deps,
  });
  assert.equal(k.leads.length, 1);

  const r2 = await processMetaLeadGen({
    orgId: ORG, orgSettings: null, appSecret: APP_SECRET, pageAccessToken: PAGE_TOKEN,
    payload: { entry: [{ changes: [{ field: "leadgen", value: { leadgen_id: "LGN-RACE-2" } }] }] },
    deps: d.deps,
  });
  assert.equal(r2.kind, "duplicate");
  assert.equal(k.leads.length, 1, "P2002 path never creates a second row");
  assert.equal(d.emitted.length, 2);
});
// ─── Phone-format dedupe, Recycle Bin restore, batched deliveries ────────────

function seedLead(k: ReturnType<typeof makeDb>, phone: string, deletedAt: Date | null = null): FakeLead {
  const row: FakeLead = {
    orgId: ORG, id: `seed-${phone}`, name: "Existing Person", email: null, phone,
    courseInterest: null, status: "NEW", createdAt: NOW, customFields: {}, deletedAt,
  };
  k.leads.push(row);
  return row;
}

test("dedupe: the same mobile stored without +91/spaces converges instead of creating a duplicate", async () => {
  const k = makeDb();
  const existing = seedLead(k, "9988776655");
  const d = makeDeps(k.db);
  const r = await processMetaLeadGen({
    orgId: ORG, orgSettings: null, appSecret: APP_SECRET, pageAccessToken: PAGE_TOKEN,
    payload: validPayload, deps: d.deps,
  });
  assert.deepEqual(r, { kind: "duplicate", leadId: existing.id, test: false });
  assert.equal(k.leads.length, 1, "no second lead row for the same person");
});

test("recycle bin: a new Facebook lead for a binned phone restores that lead", async () => {
  const k = makeDb();
  const binned = seedLead(k, "+919988776655", new Date("2026-09-01T00:00:00.000Z"));
  const d = makeDeps(k.db);
  const r = await processMetaLeadGen({
    orgId: ORG, orgSettings: null, appSecret: APP_SECRET, pageAccessToken: PAGE_TOKEN,
    payload: validPayload, deps: d.deps,
  });
  assert.equal(r.kind, "duplicate");
  assert.equal(binned.deletedAt, null, "lead is restored out of the Recycle Bin");
  assert.equal(k.leads.length, 1);
  assert.ok(d.logs.some((l) => l.event === "facebook_leadgen_restored"));
});

test("batch: every leadgen change in one delivery is processed", async () => {
  const k = makeDb();
  let n = 0;
  const d = makeDeps(k.db, async (requestedId: string) => {
    n += 1;
    return {
      ok: true,
      status: 200,
      json: { ...graphLead, id: requestedId, field_data: [
        { name: "full_name", values: [`Person ${n}`] },
        { name: "phone_number", values: [`+91 90000 0000${n}`] },
      ] },
    };
  });
  const payload: MetaWebhookPayload = {
    object: "page",
    entry: [
      { id: "page-1", changes: [
        { field: "leadgen", value: { leadgen_id: "LGN-A", form_id: "f" } },
        { field: "leadgen", value: { leadgen_id: "LGN-B", form_id: "f" } },
      ] },
      { id: "page-1", changes: [{ field: "leadgen", value: { leadgen_id: "LGN-C", form_id: "f" } }] },
    ],
  };
  const { result, results } = await processMetaLeadGenBatch({
    orgId: ORG, orgSettings: null, appSecret: APP_SECRET, pageAccessToken: PAGE_TOKEN, payload, deps: d.deps,
  });
  assert.equal(results.length, 3);
  assert.equal(k.leads.length, 3, "all three leads persisted, not just the first entry");
  assert.equal(result.kind, "created");
});

test("batch: a transient Graph failure on any change makes the delivery retryable", async () => {
  const k = makeDb();
  const d = makeDeps(k.db, async (requestedId: string) =>
    requestedId === "LGN-B"
      ? { ok: false, status: 500, json: {} }
      : { ok: true, status: 200, json: { ...graphLead, id: requestedId } },
  );
  const payload: MetaWebhookPayload = {
    object: "page",
    entry: [{ id: "page-1", changes: [
      { field: "leadgen", value: { leadgen_id: "LGN-A", form_id: "f" } },
      { field: "leadgen", value: { leadgen_id: "LGN-B", form_id: "f" } },
    ] }],
  };
  const { result } = await processMetaLeadGenBatch({
    orgId: ORG, orgSettings: null, appSecret: APP_SECRET, pageAccessToken: PAGE_TOKEN, payload, deps: d.deps,
  });
  assert.equal(result.kind, "provider_error");
  assert.equal(k.leads.length, 1, "the successful change is still saved; redelivery dedupes on leadgen_id");
});
