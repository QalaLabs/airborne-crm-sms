/**
 * Printable admission letters (offer letter, fee update). The renderer only prints facts
 * taken from the dossier; any legal/financial body wording must come from approved copy
 * stored in organization settings (`settings.letterTemplates.<kind>`). When that copy is
 * absent the letter is marked as a draft instead of inventing text.
 */

export type LetterKind = "offer" | "fee-update";

export interface ApprovedLetterCopy {
  body: string;
  approvedBy?: string;
  approvedAt?: string;
}

export interface FeeSnapshotItem {
  name: string;
  resolvedAmount?: number | string | null;
  amount?: number | string | null;
  dueOffsetDays?: number | null;
}

export interface LetterData {
  org: { name: string; logoUrl?: string | null };
  applicationNo: string;
  applicantName: string;
  applicantEmail?: string | null;
  applicantPhone?: string | null;
  studentCode?: string | null;
  courseName?: string | null;
  batchName?: string | null;
  batchStartDate?: Date | string | null;
  campusName?: string | null;
  counselorName?: string | null;
  feeAmount?: number | string | null;
  feeDiscount?: number | string | null;
  feeFinal?: number | string | null;
  feePaid?: number | string | null;
  feeBalance?: number | string | null;
  feePlan?: { name?: string | null; currency?: string | null; appliedAt?: string | null; items: FeeSnapshotItem[] } | null;
  issuedAt: Date;
  approvedCopy?: ApprovedLetterCopy | null;
}

const LETTER_TITLES: Record<LetterKind, string> = { offer: "Offer Letter", "fee-update": "Fee Update" };

export function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function toNumber(v: number | string | null | undefined): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

export function formatInr(v: number | string | null | undefined): string {
  const n = toNumber(v);
  if (n === null) return "—";
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
}

export function formatLetterDate(v: Date | string | null | undefined): string {
  if (!v) return "—";
  const d = v instanceof Date ? v : new Date(v);
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "long", year: "numeric", timeZone: "Asia/Kolkata" }).format(d);
}

/** Values the approved copy may reference as {{token}}; anything else is rejected. */
export function letterTokens(data: LetterData): Record<string, string> {
  return {
    applicant_name: data.applicantName,
    application_no: data.applicationNo,
    student_code: data.studentCode ?? "—",
    course_name: data.courseName ?? "—",
    batch_name: data.batchName ?? "—",
    batch_start_date: formatLetterDate(data.batchStartDate),
    campus_name: data.campusName ?? "—",
    org_name: data.org.name,
    fee_final: formatInr(data.feeFinal),
    fee_paid: formatInr(data.feePaid),
    fee_balance: formatInr(data.feeBalance),
    issue_date: formatLetterDate(data.issuedAt),
  };
}

export class UnresolvedPlaceholderError extends Error {
  constructor(public readonly tokens: string[]) {
    super(`Approved letter copy references unknown placeholders: ${tokens.join(", ")}`);
  }
}

/** Escapes the approved copy, substitutes whitelisted tokens and fails on anything unresolved. */
export function renderApprovedBody(body: string, tokens: Record<string, string>): string {
  const unknown = new Set<string>();
  const html = escapeHtml(body).replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_m, key: string) => {
    if (!(key in tokens)) {
      unknown.add(key);
      return "";
    }
    return escapeHtml(tokens[key]);
  });
  if (unknown.size > 0) throw new UnresolvedPlaceholderError([...unknown]);
  if (/\{\{|\}\}/.test(html)) throw new UnresolvedPlaceholderError(["malformed placeholder"]);
  return html
    .split(/\r?\n\s*\r?\n/)
    .map((p) => `<p>${p.replace(/\r?\n/g, "<br/>")}</p>`)
    .join("\n");
}

function row(label: string, value: string): string {
  return `<tr><th scope="row">${escapeHtml(label)}</th><td>${escapeHtml(value)}</td></tr>`;
}

export function renderLetterHtml(kind: LetterKind, data: LetterData): { html: string; approved: boolean } {
  const title = LETTER_TITLES[kind];
  const approved = !!data.approvedCopy?.body?.trim();

  const details = [
    row("Applicant", data.applicantName),
    row("Application No.", data.applicationNo),
    data.studentCode ? row("Student Code", data.studentCode) : "",
    row("Course", data.courseName ?? "—"),
    row("Batch", data.batchName ?? "—"),
    row("Batch Start", formatLetterDate(data.batchStartDate)),
    data.campusName ? row("Campus", data.campusName) : "",
  ].join("");

  const fees = [
    row("Course Fee", formatInr(data.feeAmount)),
    row("Discount", formatInr(data.feeDiscount)),
    row("Final Fee", formatInr(data.feeFinal)),
    ...(kind === "fee-update" ? [row("Paid to Date", formatInr(data.feePaid)), row("Balance Due", formatInr(data.feeBalance))] : []),
  ].join("");

  const plan = data.feePlan;
  const planTable =
    plan && plan.items.length > 0
      ? `<h2>Fee Plan${plan.name ? `: ${escapeHtml(plan.name)}` : ""}</h2>
<table class="grid"><thead><tr><th>Instalment</th><th>Amount</th><th>Due</th></tr></thead><tbody>
${plan.items
  .map(
    (i) =>
      `<tr><td>${escapeHtml(i.name)}</td><td>${escapeHtml(formatInr(i.resolvedAmount ?? i.amount))}</td><td>${escapeHtml(
        typeof i.dueOffsetDays === "number" ? (i.dueOffsetDays === 0 ? "At enrolment" : `${i.dueOffsetDays} days after enrolment`) : "—",
      )}</td></tr>`,
  )
  .join("\n")}
</tbody></table>`
      : "";

  const body = approved
    ? `<section class="body" data-approved="true">${renderApprovedBody(data.approvedCopy!.body, letterTokens(data))}</section>`
    : `<section class="draft" role="alert" data-approved="false"><strong>DRAFT — NOT FOR ISSUE.</strong> The approved Airborne ${escapeHtml(
        title.toLowerCase(),
      )} wording has not been configured for ${escapeHtml(data.org.name)}. Only dossier facts are shown below.</section>`;

  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"/><title>${escapeHtml(title)} — ${escapeHtml(data.applicationNo)}</title>
<style>
body{font-family:Georgia,'Times New Roman',serif;color:#111;max-width:780px;margin:32px auto;padding:0 24px;line-height:1.5}
header{display:flex;justify-content:space-between;align-items:center;border-bottom:2px solid #111;padding-bottom:12px;margin-bottom:20px}
header img{max-height:56px}
h1{font-size:22px;margin:0}h2{font-size:15px;margin:24px 0 8px}
table{border-collapse:collapse;width:100%}th,td{text-align:left;padding:6px 8px;border-bottom:1px solid #ddd;font-size:13px}
th[scope=row]{width:38%;color:#444}.grid th{background:#f3f3f3}
.draft{border:2px dashed #b45309;background:#fffbeb;color:#92400e;padding:12px;margin:16px 0;font-family:Arial,sans-serif;font-size:13px}
.meta{font-size:12px;color:#555}
@media print{body{margin:0}}
</style></head>
<body>
<header><div><h1>${escapeHtml(title)}</h1><div class="meta">${escapeHtml(data.org.name)} · Issued ${escapeHtml(formatLetterDate(data.issuedAt))}</div></div>${
    data.org.logoUrl && /^https:\/\//i.test(data.org.logoUrl) ? `<img src="${escapeHtml(data.org.logoUrl)}" alt="${escapeHtml(data.org.name)}"/>` : ""
  }</header>
${body}
<h2>Admission Details</h2>
<table>${details}</table>
<h2>Fees</h2>
<table>${fees}</table>
${planTable}
${data.counselorName ? `<p class="meta">Counselor: ${escapeHtml(data.counselorName)}</p>` : ""}
${approved && data.approvedCopy?.approvedAt ? `<p class="meta">Template approved ${escapeHtml(formatLetterDate(data.approvedCopy.approvedAt))}${data.approvedCopy.approvedBy ? ` by ${escapeHtml(data.approvedCopy.approvedBy)}` : ""}</p>` : ""}
</body></html>`;

  return { html, approved };
}

export function readApprovedCopy(settings: unknown, kind: LetterKind): ApprovedLetterCopy | null {
  const key = kind === "offer" ? "offerLetter" : "feeUpdate";
  const tpl = (settings as { letterTemplates?: Record<string, unknown> } | null)?.letterTemplates?.[key] as
    | Partial<ApprovedLetterCopy>
    | undefined;
  if (!tpl || typeof tpl.body !== "string" || !tpl.body.trim()) return null;
  return {
    body: tpl.body,
    approvedBy: typeof tpl.approvedBy === "string" ? tpl.approvedBy : undefined,
    approvedAt: typeof tpl.approvedAt === "string" ? tpl.approvedAt : undefined,
  };
}
