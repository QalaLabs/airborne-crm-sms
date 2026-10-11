import test from "node:test";
import assert from "node:assert/strict";
import {
  LEAD_EXPORT_HEADERS,
  csvLine,
  formatExportDateIST,
  leadExportFilename,
  leadExportPreamble,
  leadExportRow,
  type LeadExportRecord,
} from "./lead-export";

function record(over: Partial<LeadExportRecord> = {}): LeadExportRecord {
  return {
    id: "lead-1",
    name: "Asha Rao",
    email: "asha@example.com",
    phone: "9876543210",
    city: "Delhi",
    state: "DL",
    pincode: "110075",
    courseInterest: "CPL",
    source: "WALK_IN",
    status: "CALL_BACK",
    score: 42,
    manualAmount: 1500.5,
    lostReason: null,
    nextFollowUp: new Date("2026-10-01T18:30:00.000Z"),
    lastActivityAt: null,
    createdAt: new Date("2026-09-30T18:29:00.000Z"),
    utmSource: null,
    utmMedium: null,
    utmCampaign: null,
    counselor: { name: "Counselor One" },
    campus: null,
    ...over,
  };
}

test("preamble is a UTF-8 BOM followed by the header row", () => {
  const pre = leadExportPreamble();
  assert.ok(pre.startsWith("\uFEFF"));
  assert.equal(pre.slice(1), LEAD_EXPORT_HEADERS.join(",") + "\r\n");
});

test("row has one value per header with labels and IST timestamps", () => {
  const row = leadExportRow(record());
  assert.equal(row.length, LEAD_EXPORT_HEADERS.length);
  assert.equal(row[LEAD_EXPORT_HEADERS.indexOf("Source")], "Walk-in");
  assert.equal(row[LEAD_EXPORT_HEADERS.indexOf("Status")], "Call Back");
  assert.equal(row[LEAD_EXPORT_HEADERS.indexOf("Manual Amount")], 1500.5);
  assert.equal(row[LEAD_EXPORT_HEADERS.indexOf("Created (IST)")], "2026-09-30 23:59");
  assert.equal(row[LEAD_EXPORT_HEADERS.indexOf("Next Follow-up (IST)")], "2026-10-02 00:00");
  assert.equal(row[LEAD_EXPORT_HEADERS.indexOf("Assigned Counselor")], "Counselor One");
});

test("special characters are quoted and quotes doubled", () => {
  const line = csvLine(leadExportRow(record({ name: 'Rao, "Captain"\nAsha', city: "Pune" })));
  assert.ok(line.includes('"Rao, ""Captain""\nAsha"'));
  assert.ok(line.endsWith("\r\n"));
});

test("formula injection is neutralised in every text cell", () => {
  const line = csvLine(
    leadExportRow(record({ name: "=HYPERLINK(\"http://x\")", email: "+cmd@x.com", courseInterest: "@SUM(A1)", city: "-2+3" })),
  );
  assert.ok(line.includes(`"'=HYPERLINK(""http://x"")"`));
  assert.ok(line.includes("'+cmd@x.com"));
  assert.ok(line.includes("'@SUM(A1)"));
  assert.ok(line.includes("'-2+3"));
});

test("unicode names survive unchanged", () => {
  assert.ok(csvLine(leadExportRow(record({ name: "अर्जुन कपूर" }))).includes("अर्जुन कपूर"));
});

test("null and missing values become empty cells", () => {
  const row = leadExportRow(record({ email: null, manualAmount: null, counselor: null }));
  assert.equal(row[LEAD_EXPORT_HEADERS.indexOf("Email")], null);
  assert.equal(row[LEAD_EXPORT_HEADERS.indexOf("Manual Amount")], null);
  assert.equal(row[LEAD_EXPORT_HEADERS.indexOf("Assigned Counselor")], "");
  assert.equal(formatExportDateIST(null), "");
});

test("filename uses the IST date and only safe characters", () => {
  assert.equal(leadExportFilename(new Date("2026-10-01T19:00:00.000Z")), "leads-2026-10-02.csv");
  assert.match(leadExportFilename(), /^leads-\d{4}-\d{2}-\d{2}\.csv$/);
});
