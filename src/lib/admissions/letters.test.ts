import test from "node:test";
import assert from "node:assert/strict";
import {
  escapeHtml,
  formatInr,
  formatLetterDate,
  readApprovedCopy,
  renderApprovedBody,
  renderLetterHtml,
  UnresolvedPlaceholderError,
  type LetterData,
} from "@/lib/admissions/letters";

const base = (over: Partial<LetterData> = {}): LetterData => ({
  org: { name: "Airborne Aviation Academy" },
  applicationNo: "APP-2026-0042",
  applicantName: "Asha Rao",
  courseName: "Commercial Pilot License",
  batchName: "CPL Jan 2027",
  batchStartDate: "2027-01-15T00:00:00.000Z",
  feeAmount: "450000",
  feeDiscount: "25000",
  feeFinal: "425000",
  feePaid: "100000",
  feeBalance: "325000",
  feePlan: {
    name: "CPL 3-part",
    items: [
      { name: "Booking", resolvedAmount: 100000, dueOffsetDays: 0 },
      { name: "Second", resolvedAmount: 162500, dueOffsetDays: 30 },
    ],
  },
  issuedAt: new Date("2026-10-02T06:00:00Z"),
  ...over,
});

test("B2/B3: escapeHtml covers all HTML-significant characters", () => {
  assert.equal(escapeHtml(`<img src=x onerror="a('b')">&`), "&lt;img src=x onerror=&quot;a(&#39;b&#39;)&quot;&gt;&amp;");
});

test("B2/B3: INR and date formatting (en-IN, IST)", () => {
  assert.equal(formatInr("425000"), "₹4,25,000.00");
  assert.equal(formatInr(null), "—");
  assert.equal(formatLetterDate("2027-01-15T00:00:00.000Z"), "15 January 2027");
  assert.equal(formatLetterDate("garbage"), "—");
});

test("B2: offer letter uses real dossier values and is draft-marked without approved copy", () => {
  const { html, approved } = renderLetterHtml("offer", base());
  assert.equal(approved, false);
  assert.match(html, /DRAFT — NOT FOR ISSUE/);
  assert.match(html, /APP-2026-0042/);
  assert.match(html, /Asha Rao/);
  assert.match(html, /Commercial Pilot License/);
  assert.match(html, /15 January 2027/);
  assert.match(html, /₹4,25,000\.00/);
  assert.doesNotMatch(html, /Balance Due/, "offer letter does not show running balance");
  assert.doesNotMatch(html.split("</style>")[1]!, /\{\{|\}\}|undefined|NaN|null/);
});

test("B3: fee update prints stored paid/balance and fee-plan snapshot without recalculation", () => {
  // Deliberately inconsistent stored numbers: the renderer must print what is stored.
  const { html } = renderLetterHtml("fee-update", base({ feeFinal: "425000", feePaid: "100000", feeBalance: "300000" }));
  assert.match(html, /Paid to Date<\/th><td>₹1,00,000\.00/);
  assert.match(html, /Balance Due<\/th><td>₹3,00,000\.00/);
  assert.doesNotMatch(html, /₹3,25,000\.00/);
  assert.match(html, /Fee Plan: CPL 3-part/);
  assert.match(html, /Booking<\/td><td>₹1,00,000\.00<\/td><td>At enrolment/);
  assert.match(html, /30 days after enrolment/);
});

test("B2/B3: all dossier values are escaped", () => {
  const { html } = renderLetterHtml("fee-update", base({ applicantName: "<script>alert(1)</script>", courseName: `"><img onerror=x>` }));
  assert.doesNotMatch(html, /<script>alert/);
  assert.doesNotMatch(html, /<img onerror/);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
});

test("B2/B3: missing optional data renders placeholders, never undefined", () => {
  const { html } = renderLetterHtml("fee-update", base({ batchName: null, batchStartDate: null, feePlan: null, feeAmount: null }));
  assert.doesNotMatch(html, /undefined|NaN|Fee Plan/);
  assert.match(html, /Batch<\/th><td>—/);
});

test("B2/B3: non-https logo is dropped", () => {
  const { html } = renderLetterHtml("offer", base({ org: { name: "X", logoUrl: "javascript:alert(1)" } }));
  assert.doesNotMatch(html, /<img/);
});

test("B2/B3: approved copy is escaped, tokens substituted, and draft banner removed", () => {
  const { html, approved } = renderLetterHtml(
    "offer",
    base({ approvedCopy: { body: "Dear {{applicant_name}},\n\nYour seat in {{ course_name }} <b>is held</b>.", approvedAt: "2026-09-01" } }),
  );
  assert.equal(approved, true);
  assert.doesNotMatch(html, /DRAFT/);
  assert.match(html, /<p>Dear Asha Rao,<\/p>/);
  assert.match(html, /Commercial Pilot License &lt;b&gt;is held&lt;\/b&gt;/);
});

test("B2/B3: unknown or malformed placeholders fail instead of rendering", () => {
  assert.throws(() => renderApprovedBody("Hi {{unknown_token}}", { a: "1" }), UnresolvedPlaceholderError);
  assert.throws(() => renderApprovedBody("Hi {{ broken", { a: "1" }), UnresolvedPlaceholderError);
});

test("B2/B3: approved copy is read only from org settings", () => {
  assert.equal(readApprovedCopy({}, "offer"), null);
  assert.equal(readApprovedCopy({ letterTemplates: { offerLetter: { body: "  " } } }, "offer"), null);
  assert.deepEqual(readApprovedCopy({ letterTemplates: { feeUpdate: { body: "B", approvedBy: "CFO" } } }, "fee-update"), {
    body: "B",
    approvedBy: "CFO",
    approvedAt: undefined,
  });
});
