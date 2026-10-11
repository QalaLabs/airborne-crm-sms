import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "@/lib/db/client";
import { AppError } from "@/lib/utils/errors";
import {
  MAX_ANALYTICS_RANGE_DAYS,
  istMonthKey,
  istMonthKeysBetween,
  parseAnalyticsRange,
  parseISTWallClock,
} from "./date-range";
import { buildAnalyticsReport } from "./report.service";
import { ANALYTICS_CSV_HEADER, analyticsCsvFilename, analyticsReportToCsv } from "./report-csv";
import { csvCell, toCsv } from "@/lib/utils/csv";

const ORG = "00000000-0000-4000-8000-0000000000aa";
const OTHER_ORG = "00000000-0000-4000-8000-0000000000bb";
const NOW = new Date("2026-10-02T06:30:00.000Z"); // 12:00 IST

const q = (from?: string, to?: string) => {
  const p = new URLSearchParams();
  if (from !== undefined) p.set("from", from);
  if (to !== undefined) p.set("to", to);
  return p;
};
const isValidation = (e: unknown) => e instanceof AppError && e.statusCode === 400;

describe("parseAnalyticsRange (IST, inclusive bounds)", () => {
  it("no params -> all time", () => {
    assert.equal(parseAnalyticsRange(q(), NOW), null);
  });

  it("date-only range spans IST midnight to 23:59:59.999 IST", () => {
    const r = parseAnalyticsRange(q("2026-09-01", "2026-09-30"), NOW)!;
    assert.equal(r.from.toISOString(), "2026-08-31T18:30:00.000Z");
    assert.equal(r.to.toISOString(), "2026-09-30T18:29:59.999Z");
  });

  it("time bounds: `to` includes the whole minute", () => {
    const r = parseAnalyticsRange(q("2026-09-10T09:15", "2026-09-10T17:45"), NOW)!;
    assert.equal(r.from.toISOString(), "2026-09-10T03:45:00.000Z");
    assert.equal(r.to.toISOString(), "2026-09-10T12:15:59.999Z");
  });

  it("same start and end is allowed (single minute / single day)", () => {
    const minute = parseAnalyticsRange(q("2026-09-10T10:00", "2026-09-10T10:00"), NOW)!;
    assert.equal(minute.to.getTime() - minute.from.getTime(), 59_999);
    const day = parseAnalyticsRange(q("2026-09-10", "2026-09-10"), NOW)!;
    assert.equal(day.to.getTime() - day.from.getTime(), 86_400_000 - 1);
  });

  it("midnight boundary: 00:00 IST belongs to the new day, 23:59 to the old", () => {
    const startOfDay = parseISTWallClock("2026-09-11T00:00", "start")!;
    const endPrev = parseISTWallClock("2026-09-10T23:59", "end")!;
    assert.equal(startOfDay.getTime() - endPrev.getTime(), 1);
    assert.equal(istMonthKey(new Date("2026-09-30T18:30:00.000Z")), "2026-10"); // 00:00 IST Oct 1
    assert.equal(istMonthKey(new Date("2026-09-30T18:29:59.999Z")), "2026-09");
  });

  it("rejects missing start or end", () => {
    assert.throws(() => parseAnalyticsRange(q("2026-09-01"), NOW), isValidation);
    assert.throws(() => parseAnalyticsRange(q(undefined, "2026-09-01"), NOW), isValidation);
    assert.throws(() => parseAnalyticsRange(q("", "2026-09-01"), NOW), isValidation);
  });

  it("rejects start after end", () => {
    assert.throws(() => parseAnalyticsRange(q("2026-09-02", "2026-09-01"), NOW), isValidation);
    assert.throws(() => parseAnalyticsRange(q("2026-09-01T10:01", "2026-09-01T10:00"), NOW), isValidation);
  });

  it("rejects a future start but allows an end in the future", () => {
    assert.throws(() => parseAnalyticsRange(q("2026-10-03", "2026-10-05"), NOW), isValidation);
    assert.throws(() => parseAnalyticsRange(q("2026-10-02T12:01", "2026-10-02T13:00"), NOW), isValidation);
    const r = parseAnalyticsRange(q("2026-10-01", "2026-10-31"), NOW)!;
    assert.ok(r.to > NOW);
  });

  it("rejects malformed and impossible dates", () => {
    for (const bad of ["2026-02-30", "2026-13-01", "01-09-2026", "2026-09-01T25:00", "1999-01-01", "abc"]) {
      assert.throws(() => parseAnalyticsRange(q(bad, "2026-09-30"), NOW), isValidation, bad);
    }
  });

  it("rejects a range larger than the cap, accepts one just inside", () => {
    assert.throws(() => parseAnalyticsRange(q("2020-01-01", "2026-09-30"), NOW), isValidation);
    const ok = parseAnalyticsRange(q("2022-01-01", "2026-09-30"), NOW)!;
    assert.ok(ok.to.getTime() - ok.from.getTime() <= MAX_ANALYTICS_RANGE_DAYS * 86_400_000);
  });

  it("month keys cover the range inclusively across a year boundary", () => {
    const r = parseAnalyticsRange(q("2025-11-15", "2026-02-03"), NOW)!;
    assert.deepEqual(istMonthKeysBetween(r.from, r.to), ["2025-11", "2025-12", "2026-01", "2026-02"]);
  });
});

describe("csv writer", () => {
  it("escapes commas, quotes and newlines (RFC 4180)", () => {
    assert.equal(csvCell("a,b"), '"a,b"');
    assert.equal(csvCell('say "hi"'), '"say ""hi"""');
    assert.equal(csvCell("line1\nline2"), '"line1\nline2"');
    assert.equal(csvCell(null), "");
    assert.equal(csvCell(12.5), "12.5");
    assert.equal(csvCell(-3), "-3");
  });

  it("neutralises spreadsheet formulas in text cells", () => {
    assert.equal(csvCell("=HYPERLINK(\"x\")"), "\"'=HYPERLINK(\"\"x\"\")\"");
    assert.equal(csvCell("+91 98"), "'+91 98");
    assert.equal(csvCell("@cmd"), "'@cmd");
  });

  it("writes a UTF-8 BOM and CRLF rows, keeps unicode", () => {
    const out = toCsv([["Name"], ["राहुल ₹"]]);
    assert.ok(out.startsWith("\uFEFF"));
    assert.equal(out, "\uFEFFName\r\nराहुल ₹\r\n");
  });
});

// ── Report service: DB-level filtering, scope, CSV ──────────────────────────

type Call = { model: string; op: string; where: any };

function installPrisma(fixture: { counselors?: { id: string; name: string }[]; sources?: { source: string; n: number }[] } = {}) {
  const calls: Call[] = [];
  const saved: Record<string, any> = {};
  const models: Record<string, Record<string, (args: any) => any>> = {
    lead: {
      groupBy: (a) =>
        a.by[0] === "status"
          ? [{ status: "NEW", _count: { _all: 3 } }]
          : a.by[0] === "source"
            ? (fixture.sources ?? [{ source: "Google, Ads \"Search\"", n: 3 }]).map((s) => ({ source: s.source, _count: { _all: s.n } }))
            : [],
      findMany: () => [{ id: "l1", createdAt: new Date("2026-09-05T10:00:00Z") }],
      count: () => 1,
    },
    admission: {
      aggregate: () => ({ _avg: { feeFinal: null }, _count: { _all: 0 } }),
      count: () => 0,
      findMany: () => [],
      groupBy: () => [],
    },
    paymentTransaction: {
      aggregate: () => ({ _sum: { amount: null }, _count: { _all: 0 } }),
      findMany: () => [],
    },
    leadActivity: { groupBy: () => [] },
    user: { findMany: () => fixture.counselors ?? [{ id: "c1", name: "=Evil, \"Rep\"" }] },
    student: { count: () => 0 },
    deal: { count: () => 0, findMany: () => [] },
  };
  for (const [model, ops] of Object.entries(models)) {
    saved[model] = {};
    for (const [op, impl] of Object.entries(ops)) {
      saved[model][op] = (prisma as any)[model][op];
      (prisma as any)[model][op] = async (args: any) => {
        calls.push({ model, op, where: args?.where });
        return impl(args ?? {});
      };
    }
  }
  return {
    calls,
    restore() {
      for (const [model, ops] of Object.entries(saved)) {
        for (const [op, fn] of Object.entries(ops)) (prisma as any)[model][op] = fn;
      }
    },
  };
}

let harness: ReturnType<typeof installPrisma> | null = null;
afterEach(() => {
  harness?.restore();
  harness = null;
});

const ADMIN = { id: "admin-1", role: "ADMIN" };
const COUNSELOR = { id: "c1", role: "ADMISSIONS_COUNSELOR" };

describe("buildAnalyticsReport", () => {
  it("filters every aggregate in the DB query by createdAt when a range is given", async () => {
    harness = installPrisma();
    const range = parseAnalyticsRange(q("2026-09-01T09:00", "2026-09-30T18:00"), NOW)!;
    const report = await buildAnalyticsReport(ADMIN, ORG, range, NOW);

    const rangedModels = ["lead", "admission", "paymentTransaction", "leadActivity", "student"];
    for (const c of harness.calls.filter((c) => rangedModels.includes(c.model))) {
      assert.equal(c.where.orgId, ORG, `${c.model}.${c.op} org scoped`);
      const ca = c.where.createdAt;
      assert.ok(ca, `${c.model}.${c.op} has createdAt filter`);
      assert.ok(ca.gte >= range.from, `${c.model}.${c.op} lower bound`);
      assert.ok(ca.lte && ca.lte <= range.to, `${c.model}.${c.op} upper bound`);
    }
    const dealPipeline = harness.calls.find((c) => c.model === "deal" && c.op === "findMany" && !c.where.admissionId);
    assert.deepEqual(dealPipeline?.where.createdAt, { gte: range.from, lte: range.to });
    const dealsWon = harness.calls.find((c) => c.model === "deal" && c.op === "count");
    assert.deepEqual(dealsWon?.where.wonAt, { gte: range.from, lte: range.to });

    assert.equal(report.range?.fromInput, "2026-09-01T09:00");
    assert.equal(report.range?.timezone, "Asia/Kolkata");
    assert.deepEqual(report.monthly.map((m) => m.key), ["2026-09"]);
    assert.equal(report.monthly[0]!.leads, 1);
  });

  it("without a range keeps all-time totals (no createdAt on totals) and 6 IST months", async () => {
    harness = installPrisma();
    const report = await buildAnalyticsReport(ADMIN, ORG, null, NOW);
    const statusGroup = harness.calls.find((c) => c.model === "lead" && c.op === "groupBy");
    assert.equal(statusGroup?.where.createdAt, undefined);
    assert.equal(report.range, null);
    assert.deepEqual(report.monthly.map((m) => m.key), ["2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10"]);
  });

  it("counselor scope survives the range filter and never reads org-wide", async () => {
    harness = installPrisma();
    const range = parseAnalyticsRange(q("2026-09-01", "2026-09-30"), NOW)!;
    const report = await buildAnalyticsReport(COUNSELOR, ORG, range, NOW);
    assert.equal(report.scope, "counselor");
    for (const c of harness.calls) {
      if (c.model === "lead") assert.equal(c.where.assignedTo, "c1", `lead.${c.op}`);
      if (c.model === "admission") assert.deepEqual(c.where.lead, { assignedTo: "c1" });
      if (c.model === "paymentTransaction") assert.deepEqual(c.where.admission, { lead: { assignedTo: "c1" } });
      if (c.model === "leadActivity") assert.equal(c.where.performedBy, "c1");
      if (c.model === "deal") assert.equal(c.where.assignedTo, "c1");
      if (c.model === "user") assert.equal(c.where.id, "c1");
    }
  });

  it("org isolation: every query carries the caller's orgId only", async () => {
    harness = installPrisma();
    await buildAnalyticsReport(ADMIN, OTHER_ORG, null, NOW);
    for (const c of harness.calls) assert.equal(c.where.orgId, OTHER_ORG, `${c.model}.${c.op}`);
  });
});

describe("analytics CSV export", () => {
  it("has the fixed header, range metadata, escaped special characters and multiple rows", async () => {
    harness = installPrisma();
    const range = parseAnalyticsRange(q("2026-09-01", "2026-09-30"), NOW)!;
    const report = await buildAnalyticsReport(ADMIN, ORG, range, NOW);
    const csv = analyticsReportToCsv(report, NOW);
    const lines = csv.replace(/^\uFEFF/, "").trimEnd().split("\r\n");

    assert.ok(csv.startsWith("\uFEFF"));
    assert.equal(lines[0], ANALYTICS_CSV_HEADER.join(","));
    assert.ok(lines.includes("Report,,Range From (IST),2026-09-01"));
    assert.ok(lines.includes("Report,,Range To (IST),2026-09-30"));
    assert.ok(lines.includes("Report,,Scope,Organization"));
    assert.ok(lines.includes("Totals,,Total Leads,3"));
    assert.ok(lines.includes('By Source,"Google, Ads ""Search""",Leads,3'));
    assert.ok(lines.some((l) => l.startsWith("By Counselor,\"'=Evil, \"\"Rep\"\"\",Leads,")));
    assert.ok(lines.length > 40);
    assert.equal(analyticsCsvFilename(report), "airborne-analytics_2026-09-01_to_2026-09-30.csv");
  });

  it("empty dataset still yields a valid CSV with header + metadata", async () => {
    harness = installPrisma({ counselors: [], sources: [] });
    const report = await buildAnalyticsReport(ADMIN, ORG, null, NOW);
    const csv = analyticsReportToCsv(report, NOW);
    const lines = csv.replace(/^\uFEFF/, "").trimEnd().split("\r\n");
    assert.equal(lines[0], "Section,Dimension,Metric,Value");
    assert.ok(lines.includes("Report,,Range From (IST),All time"));
    assert.ok(!lines.some((l) => l.startsWith("By Counselor")));
    assert.equal(analyticsCsvFilename(report), "airborne-analytics_all-time.csv");
  });

  it("counselor export is labelled and scoped", async () => {
    harness = installPrisma();
    const report = await buildAnalyticsReport(COUNSELOR, ORG, null, NOW);
    assert.ok(analyticsReportToCsv(report, NOW).includes("Report,,Scope,Counselor (own records)"));
  });
});
