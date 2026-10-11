import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { prisma } from "@/lib/db/client";
import { evaluateCondition, isConditionSpec } from "./conditions";
import { conditionsMatch, matchAndStartRuns } from "./engine";
import { conditionSpecSchema, workflowStepSchema } from "@/lib/validations/workflow.schema";
import type { ConditionSpec } from "./types";

const ORG = "00000000-0000-4000-8000-0000000000aa";
const LEAD = "00000000-0000-4000-8000-00000000a001";
const LEGACY_CONDITIONS = { source: "FACEBOOK_ADS" };
const CANONICAL_CONDITIONS = { field: "source", op: "eq", value: "FACEBOOK_ADS" };

const lead = { id: LEAD, orgId: ORG, name: "Asha", phone: "+919800000000", source: "FACEBOOK_ADS", status: "NEW" };

test("valid conditions evaluate correctly (leaf, all, any, not, dotted event path)", () => {
  const ctx = { ...lead, score: 40, event: { newStatus: "CONTACTED" } };
  assert.equal(evaluateCondition(CANONICAL_CONDITIONS as ConditionSpec, ctx), true);
  assert.equal(evaluateCondition({ field: "source", op: "eq", value: "WEBSITE" }, ctx), false);
  assert.equal(evaluateCondition({ all: [CANONICAL_CONDITIONS as ConditionSpec, { field: "score", op: "gte", value: 40 }] }, ctx), true);
  assert.equal(evaluateCondition({ any: [{ field: "status", op: "eq", value: "LOST" }, { field: "event.newStatus", op: "eq", value: "CONTACTED" }] }, ctx), true);
  assert.equal(evaluateCondition({ not: { field: "status", op: "in", value: ["ENROLLED"] } }, ctx), true);
  assert.equal(conditionsMatch({}, ctx), true);
  assert.equal(conditionsMatch(null, ctx), true);
});

test("invalid conditions fail closed instead of throwing", () => {
  const ctx = { ...lead };
  const malformed: unknown[] = [
    LEGACY_CONDITIONS,
    { field: 42, op: "eq", value: 1 },
    { field: "source" },
    { all: "nope" },
    { any: [] },
    { all: [CANONICAL_CONDITIONS, LEGACY_CONDITIONS] },
    { not: LEGACY_CONDITIONS },
    [CANONICAL_CONDITIONS],
    "source=FACEBOOK_ADS",
  ];
  for (const spec of malformed) {
    assert.equal(isConditionSpec(spec), false, JSON.stringify(spec));
    assert.doesNotThrow(() => evaluateCondition(spec as ConditionSpec, ctx), JSON.stringify(spec));
    assert.equal(evaluateCondition(spec as ConditionSpec, ctx), false, JSON.stringify(spec));
    assert.equal(conditionsMatch(spec, ctx), false, JSON.stringify(spec));
  }
  // `not` over a malformed child must not flip into a match.
  assert.equal(evaluateCondition({ not: LEGACY_CONDITIONS } as unknown as ConditionSpec, ctx), false);
});

function engineHarness(workflows: Array<{ id: string; code: string; triggerConditions: unknown }>) {
  const wf = prisma.workflow as any;
  const ld = prisma.lead as any;
  const run = prisma.workflowRun as any;
  const orig = { findMany: wf.findMany, leadFind: ld.findFirst, create: run.create, warn: console.warn };
  const runs: any[] = [];
  const warnings: unknown[][] = [];
  wf.findMany = async () => workflows.map((w) => ({ ...w, name: w.code }));
  ld.findFirst = async (a: any) => (a.where.id === LEAD && a.where.orgId === ORG ? lead : null);
  run.create = async (a: any) => {
    const row = { id: `run-${runs.length + 1}`, ...a.data };
    runs.push(row);
    return row;
  };
  console.warn = (...args: unknown[]) => warnings.push(args);
  return {
    runs,
    warnings,
    restore() {
      wf.findMany = orig.findMany;
      ld.findFirst = orig.leadFind;
      run.create = orig.create;
      console.warn = orig.warn;
    },
  };
}

test("regression: lead/created with the legacy seeded workflow no longer crashes and valid workflows still start", async () => {
  const h = engineHarness([
    { id: "wf-legacy", code: "new-lead-welcome", triggerConditions: LEGACY_CONDITIONS },
    { id: "wf-nurture", code: "seq-nurture-21d", triggerConditions: {} },
    { id: "wf-fb", code: "fb-only", triggerConditions: CANONICAL_CONDITIONS },
    { id: "wf-web", code: "web-only", triggerConditions: { field: "source", op: "eq", value: "WEBSITE" } },
  ]);
  try {
    const result = await matchAndStartRuns({ orgId: ORG, rawEventName: "lead/created", data: { leadId: LEAD }, requestId: "req-1" });
    assert.deepEqual(h.runs.map((r) => r.workflowId), ["wf-nurture", "wf-fb"]);
    assert.equal(result.created, 2);
    assert.ok(h.runs.every((r) => r.entityType === "lead" && r.entityId === LEAD && r.context.eventName === "lead.created"));
    assert.equal(h.warnings.length, 1);
    const [message, workflowId] = h.warnings[0] ?? [];
    assert.match(String(message), /invalid triggerConditions/);
    assert.equal(workflowId, "wf-legacy");
  } finally {
    h.restore();
  }
});

test("repaired seed workflow matches Facebook leads only", async () => {
  const h = engineHarness([{ id: "wf-welcome", code: "new-lead-welcome", triggerConditions: CANONICAL_CONDITIONS }]);
  try {
    const fb = await matchAndStartRuns({ orgId: ORG, rawEventName: "lead/created", data: { leadId: LEAD }, requestId: "r-fb" });
    assert.equal(fb.created, 1);
    lead.source = "WEBSITE";
    const web = await matchAndStartRuns({ orgId: ORG, rawEventName: "lead/created", data: { leadId: LEAD }, requestId: "r-web" });
    assert.equal(web.created, 0);
    assert.equal(h.warnings.length, 0);
  } finally {
    lead.source = "FACEBOOK_ADS";
    h.restore();
  }
});

test("seed.ts and the repair migration use the canonical condition and step format", () => {
  const admin = process.cwd();
  const seed = readFileSync(path.join(admin, "prisma/seed.ts"), "utf8");
  assert.doesNotMatch(seed, /triggerConditions:\s*\{\s*source:/);
  assert.doesNotMatch(seed, /templateCode/);
  assert.match(seed, /triggerConditions: \{ field: "source", op: "eq", value: "FACEBOOK_ADS" \}/);

  const sql = readFileSync(path.join(admin, "prisma/migrations/20261002130000_repair_legacy_workflow_seed/migration.sql"), "utf8");
  const literals = [...sql.matchAll(/'(\{.*?\}|\[.*?\])'::jsonb/g)].map((m) => JSON.parse(m[1] ?? "null"));
  const [newConditions, legacyConditions, newSteps, legacySteps] = literals;
  assert.equal(literals.length, 4);
  assert.deepEqual(legacyConditions, LEGACY_CONDITIONS);
  assert.deepEqual(newConditions, CANONICAL_CONDITIONS);
  assert.ok(conditionSpecSchema.safeParse(newConditions).success);
  assert.ok(!conditionSpecSchema.safeParse(legacyConditions).success);
  assert.deepEqual(legacySteps, [{ type: "SEND_WHATSAPP", templateCode: "new-lead-welcome" }]);
  assert.ok(newSteps.every((s: unknown) => workflowStepSchema.safeParse(s).success));
  assert.match(newSteps[0].variables.message, /\{\{leadName\}\}/);
});
