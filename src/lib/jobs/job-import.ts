import { createJobSchema, type CreateJobInput } from "@/lib/validations/job.schema";
import { parseCsv } from "@/lib/leads/csv";

/**
 * Bulk job CSV contract. Columns map 1:1 onto `createJobSchema` (the same
 * validation the Create Job form/API uses) plus the three `metadata` keys the
 * public careers page renders (airline, apply URL, airline logo). Imported
 * jobs are always DRAFT, exactly like JobService.create.
 */
export const JOB_IMPORT_COLUMNS = [
  { key: "title", required: true, help: "Job title (max 255)" },
  { key: "slug", required: false, help: "lowercase-with-hyphens; generated from title when empty" },
  { key: "description", required: false, help: "max 20000 chars" },
  { key: "requirements", required: false, help: "max 10000 chars" },
  { key: "location", required: false, help: "e.g. Delhi" },
  { key: "is_remote", required: false, help: "yes/no (default no)" },
  { key: "job_type", required: false, help: "full_time | part_time | contract | internship" },
  { key: "salary_min", required: false, help: "positive number" },
  { key: "salary_max", required: false, help: "positive number, >= salary_min" },
  { key: "currency", required: false, help: "3-letter code (default INR)" },
  { key: "experience_years", required: false, help: "whole number >= 0" },
  { key: "closes_at", required: false, help: "YYYY-MM-DD (end of day IST) or ISO date-time" },
  { key: "tags", required: false, help: "separated by ; or |" },
  { key: "hiring_partner", required: false, help: "existing hiring partner name or slug" },
  { key: "airline", required: false, help: "shown on the public careers card" },
  { key: "airline_logo", required: false, help: "https image URL" },
  { key: "apply_url", required: false, help: "https external apply link" },
  { key: "seo_title", required: false, help: "max 255" },
  { key: "seo_desc", required: false, help: "max 500" },
] as const;

export type JobImportColumn = (typeof JOB_IMPORT_COLUMNS)[number]["key"];

export const MAX_JOB_IMPORT_ROWS = 500;
export const MAX_JOB_IMPORT_BYTES = 1_000_000;

export const JOB_IMPORT_TEMPLATE =
  JOB_IMPORT_COLUMNS.map((c) => c.key).join(",") +
  "\r\n" +
  'Cabin Crew Trainee,,"Join our cabin crew batch, Delhi base.",12th pass; age 18-27,Delhi,no,full_time,"25000","40000",INR,0,2026-12-31,cabin crew;fresher,,IndiGo,,https://careers.example.com/apply/123,,\r\n';

const COLUMN_KEYS = new Set<string>(JOB_IMPORT_COLUMNS.map((c) => c.key));

/** "Is Remote", "is-remote", "isRemote" -> "is_remote". */
export function canonicalJobHeader(raw: string): JobImportColumn | null {
  const key = raw
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
  return COLUMN_KEYS.has(key) ? (key as JobImportColumn) : null;
}

export interface JobImportIssue {
  rowNumber: number;
  column?: string;
  message: string;
}

export interface NormalizedJobRow {
  rowNumber: number;
  input: CreateJobInput;
  hiringPartner?: string;
  dedupeKey: string;
}

const SCHEMA_PATH_TO_COLUMN: Record<string, JobImportColumn> = {
  title: "title",
  slug: "slug",
  description: "description",
  requirements: "requirements",
  location: "location",
  isRemote: "is_remote",
  jobType: "job_type",
  salaryMin: "salary_min",
  salaryMax: "salary_max",
  currency: "currency",
  experienceYears: "experience_years",
  closesAt: "closes_at",
  tags: "tags",
  seoTitle: "seo_title",
  seoDesc: "seo_desc",
};

const IST_OFFSET_MS = 330 * 60_000;

function parseBool(v: string): boolean | null {
  const s = v.trim().toLowerCase();
  if (["yes", "y", "true", "1", "remote"].includes(s)) return true;
  if (["no", "n", "false", "0", "onsite", "on-site"].includes(s)) return false;
  return null;
}

function parseAmount(v: string): number | null {
  const cleaned = v.replace(/[₹,\s]/g, "").replace(/^inr/i, "");
  if (!/^\d+(\.\d+)?$/.test(cleaned)) return null;
  return Number(cleaned);
}

/** YYYY-MM-DD / DD-MM-YYYY / DD/MM/YYYY -> end of that IST day; ISO date-times pass through. */
export function parseClosesAt(v: string): string | null {
  const s = v.trim();
  let y: number, m: number, d: number;
  let match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (match) {
    [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  } else if ((match = /^(\d{2})[-/](\d{2})[-/](\d{4})$/.exec(s))) {
    [d, m, y] = [Number(match[1]), Number(match[2]), Number(match[3])];
  } else {
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/.test(s)) return null;
    const t = new Date(s);
    return Number.isNaN(t.getTime()) ? null : t.toISOString();
  }
  const wall = Date.UTC(y, m - 1, d, 23, 59, 59, 999);
  const check = new Date(wall);
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== m - 1 || check.getUTCDate() !== d) return null;
  return new Date(wall - IST_OFFSET_MS).toISOString();
}

export function isHttpUrl(v: string): boolean {
  try {
    const u = new URL(v);
    return (u.protocol === "https:" || u.protocol === "http:") && !u.username && !u.password;
  } catch {
    return false;
  }
}

const norm = (s: string | undefined) => (s ?? "").trim().toLowerCase().replace(/\s+/g, " ");

export function jobDedupeKey(title: string, location?: string | null, company?: string | null): string {
  return [norm(title), norm(location ?? ""), norm(company ?? "")].join("|");
}

/**
 * Normalize + validate one CSV row against createJobSchema. Org-dependent
 * checks (hiring partner, existing slugs/duplicates) happen in the service.
 */
export function normalizeJobRow(
  raw: Partial<Record<JobImportColumn, string>>,
  rowNumber: number,
  now: Date = new Date(),
): { row?: NormalizedJobRow; issues: JobImportIssue[] } {
  const issues: JobImportIssue[] = [];
  const v = (k: JobImportColumn) => {
    const s = raw[k]?.trim();
    return s ? s : undefined;
  };
  const issue = (column: JobImportColumn, message: string) => issues.push({ rowNumber, column, message });

  const candidate: Record<string, unknown> = {
    title: v("title"),
    slug: v("slug")?.toLowerCase(),
    description: v("description"),
    requirements: v("requirements"),
    location: v("location"),
    currency: v("currency")?.toUpperCase(),
    seoTitle: v("seo_title"),
    seoDesc: v("seo_desc"),
  };
  if (!candidate.title) issue("title", "title is required");

  const remote = v("is_remote");
  if (remote !== undefined) {
    const b = parseBool(remote);
    if (b === null) issue("is_remote", `"${remote}" is not yes/no`);
    else candidate.isRemote = b;
  }
  const jobType = v("job_type");
  if (jobType !== undefined) candidate.jobType = jobType.toLowerCase().replace(/[\s-]+/g, "_");

  for (const [col, field] of [["salary_min", "salaryMin"], ["salary_max", "salaryMax"]] as const) {
    const s = v(col);
    if (s === undefined) continue;
    const n = parseAmount(s);
    if (n === null) issue(col, `"${s}" is not a number`);
    else candidate[field] = n;
  }
  const exp = v("experience_years");
  if (exp !== undefined) {
    if (!/^\d+$/.test(exp)) issue("experience_years", `"${exp}" is not a whole number`);
    else candidate.experienceYears = Number(exp);
  }
  const closes = v("closes_at");
  if (closes !== undefined) {
    const iso = parseClosesAt(closes);
    if (!iso) issue("closes_at", `"${closes}" is not a valid date (use YYYY-MM-DD)`);
    else if (new Date(iso) <= now) issue("closes_at", `closes_at ${closes} is in the past`);
    else candidate.closesAt = iso;
  }
  const tags = v("tags");
  if (tags !== undefined) {
    candidate.tags = [...new Set(tags.split(/[;|]/).map((t) => t.trim()).filter(Boolean))];
  }

  const metadata: Record<string, string> = {};
  const airline = v("airline");
  if (airline) metadata.airline = airline;
  for (const [col, key] of [["apply_url", "applyUrl"], ["airline_logo", "airlineLogo"]] as const) {
    const s = v(col);
    if (s === undefined) continue;
    if (!isHttpUrl(s)) issue(col, `"${s}" is not a valid http(s) URL`);
    else metadata[key] = s;
  }
  candidate.metadata = metadata;

  const parsed = createJobSchema.safeParse(candidate);
  if (!parsed.success) {
    for (const zi of parsed.error.issues) {
      const field = String(zi.path[0] ?? "");
      const column = SCHEMA_PATH_TO_COLUMN[field] ?? field;
      if (field === "title" && !candidate.title) continue;
      issues.push({ rowNumber, column, message: `${column}: ${zi.message}` });
    }
  }
  const input = parsed.success ? parsed.data : null;
  if (input && input.salaryMin !== undefined && input.salaryMax !== undefined && input.salaryMin > input.salaryMax) {
    issue("salary_max", "salary_max must be greater than or equal to salary_min");
  }

  if (issues.length > 0 || !input) return { issues };
  const hiringPartner = v("hiring_partner");
  return {
    issues,
    row: {
      rowNumber,
      input,
      hiringPartner,
      dedupeKey: jobDedupeKey(input.title, input.location, airline ?? hiringPartner),
    },
  };
}

export interface ParsedJobCsv {
  fileErrors: string[];
  unknownColumns: string[];
  totalRows: number;
  rows: NormalizedJobRow[];
  issues: JobImportIssue[];
}

/** Parse + header validation + per-row normalization + in-file duplicate detection. */
export function parseJobCsv(text: string, now: Date = new Date()): ParsedJobCsv {
  const result: ParsedJobCsv = { fileErrors: [], unknownColumns: [], totalRows: 0, rows: [], issues: [] };
  if (new TextEncoder().encode(text).length > MAX_JOB_IMPORT_BYTES) {
    result.fileErrors.push(`File is larger than ${MAX_JOB_IMPORT_BYTES / 1_000_000} MB`);
    return result;
  }
  if (text.includes("\uFFFD")) {
    result.fileErrors.push("File is not valid UTF-8 — re-save it as \"CSV UTF-8\"");
    return result;
  }
  const parsed = parseCsv(text);
  if (parsed.unterminatedQuote) {
    result.fileErrors.push("Malformed CSV: a quoted cell is never closed");
    return result;
  }
  if (parsed.headers.length === 0) {
    result.fileErrors.push("The file is empty");
    return result;
  }

  const headerMap = new Map<string, JobImportColumn>();
  const seenColumns = new Set<JobImportColumn>();
  for (const h of parsed.headers) {
    if (!h) continue;
    const key = canonicalJobHeader(h);
    if (!key) {
      result.unknownColumns.push(h);
      continue;
    }
    if (seenColumns.has(key)) result.fileErrors.push(`Column "${key}" appears more than once`);
    seenColumns.add(key);
    headerMap.set(h, key);
  }
  if (result.unknownColumns.length > 0) {
    result.fileErrors.push(`Unknown column(s): ${result.unknownColumns.join(", ")}`);
  }
  for (const c of JOB_IMPORT_COLUMNS) {
    if (c.required && !seenColumns.has(c.key)) result.fileErrors.push(`Missing required column "${c.key}"`);
  }
  result.totalRows = parsed.rows.length;
  if (result.fileErrors.length > 0) return result;
  if (parsed.rows.length === 0) {
    result.fileErrors.push("The file has no data rows");
    return result;
  }
  if (parsed.rows.length > MAX_JOB_IMPORT_ROWS) {
    result.fileErrors.push(`At most ${MAX_JOB_IMPORT_ROWS} rows per upload — split the file`);
    return result;
  }

  const headerWidth = parsed.headers.length;
  const firstByKey = new Map<string, number>();
  const firstBySlug = new Map<string, number>();
  parsed.rows.forEach((rawRow, idx) => {
    const rowNumber = parsed.rowNumbers[idx] ?? idx + 2;
    if ((parsed.cellCounts[idx] ?? 0) > headerWidth) {
      result.issues.push({ rowNumber, message: `Row has ${parsed.cellCounts[idx]} cells but the header has ${headerWidth} — check for an unquoted comma` });
      return;
    }
    const mapped: Partial<Record<JobImportColumn, string>> = {};
    for (const [h, key] of headerMap) mapped[key] = rawRow[h];

    const { row, issues } = normalizeJobRow(mapped, rowNumber, now);
    result.issues.push(...issues);
    if (!row) return;

    const dupOf = firstByKey.get(row.dedupeKey);
    if (dupOf !== undefined) {
      result.issues.push({ rowNumber, message: `Duplicate of row ${dupOf} (same title, location and airline/partner)` });
      return;
    }
    if (row.input.slug) {
      const slugDup = firstBySlug.get(row.input.slug);
      if (slugDup !== undefined) {
        result.issues.push({ rowNumber, column: "slug", message: `slug "${row.input.slug}" is already used by row ${slugDup}` });
        return;
      }
      firstBySlug.set(row.input.slug, rowNumber);
    }
    firstByKey.set(row.dedupeKey, rowNumber);
    result.rows.push(row);
  });
  return result;
}
