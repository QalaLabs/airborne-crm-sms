import { createStudentSchema, type CreateStudentInput } from "@/lib/validations/student.schema";
import { parseCsv } from "@/lib/leads/csv";

/**
 * Bulk student CSV contract. Every row is validated with `createStudentSchema`,
 * the same schema POST /students uses; org-dependent rules (email uniqueness,
 * campus ownership) are applied by StudentImportService.
 */
export const STUDENT_IMPORT_COLUMNS = [
  { key: "first_name", required: true, help: "max 100" },
  { key: "last_name", required: true, help: "max 100" },
  { key: "email", required: true, help: "unique per student" },
  { key: "phone", required: true, help: "7-20 digits, optional leading +" },
  { key: "date_of_birth", required: false, help: "YYYY-MM-DD or DD-MM-YYYY" },
  { key: "gender", required: false, help: "MALE | FEMALE | OTHER" },
  { key: "nationality", required: false, help: "default Indian" },
  { key: "address_line1", required: false, help: "" },
  { key: "address_line2", required: false, help: "" },
  { key: "city", required: false, help: "" },
  { key: "state", required: false, help: "" },
  { key: "pincode", required: false, help: "max 10" },
  { key: "country", required: false, help: "2-letter code, default IN" },
  { key: "guardian_name", required: false, help: "" },
  { key: "guardian_phone", required: false, help: "" },
  { key: "guardian_email", required: false, help: "" },
  { key: "medical_fitness", required: false, help: "yes/no (default no)" },
  { key: "class10_board", required: false, help: "" },
  { key: "class10_year", required: false, help: "1990-2030" },
  { key: "class10_percent", required: false, help: "0-100" },
  { key: "class12_board", required: false, help: "" },
  { key: "class12_year", required: false, help: "1990-2030" },
  { key: "class12_percent", required: false, help: "0-100" },
  { key: "class12_stream", required: false, help: "SCIENCE | COMMERCE | ARTS | OTHER" },
  { key: "campus_code", required: false, help: "existing campus code in your organization" },
] as const;

export type StudentImportColumn = (typeof STUDENT_IMPORT_COLUMNS)[number]["key"];

export const MAX_STUDENT_IMPORT_ROWS = 150;
export const MAX_STUDENT_IMPORT_BYTES = 512_000;

export const STUDENT_IMPORT_TEMPLATE =
  STUDENT_IMPORT_COLUMNS.map((c) => c.key).join(",") +
  "\r\n" +
  'Aarav,Sharma,aarav.sharma@example.com,+919800000001,2006-04-12,MALE,Indian,"12 MG Road, Sector 4",,Delhi,Delhi,110001,IN,Rakesh Sharma,+919800000002,,yes,CBSE,2022,88.4,CBSE,2024,81.2,SCIENCE,\r\n';

const COLUMN_KEYS = new Set<string>(STUDENT_IMPORT_COLUMNS.map((c) => c.key));
const ORG_COLUMNS = new Set(["org", "org_id", "orgid", "organization", "organization_id", "organisation", "tenant"]);

/** "First Name", "first-name", "firstName" -> "first_name". */
export function canonicalStudentHeader(raw: string): StudentImportColumn | null {
  const key = raw
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
  const aliased = HEADER_ALIASES[key] ?? key;
  return COLUMN_KEYS.has(aliased) ? (aliased as StudentImportColumn) : null;
}

const HEADER_ALIASES: Record<string, StudentImportColumn> = {
  mobile: "phone",
  mobile_number: "phone",
  phone_number: "phone",
  email_address: "email",
  dob: "date_of_birth",
};

export interface StudentImportIssue {
  rowNumber: number;
  column?: string;
  message: string;
}

export interface NormalizedStudentRow {
  rowNumber: number;
  input: CreateStudentInput;
  campusCode?: string;
}

const SCHEMA_PATH_TO_COLUMN: Record<string, StudentImportColumn> = {
  firstName: "first_name",
  lastName: "last_name",
  email: "email",
  phone: "phone",
  dateOfBirth: "date_of_birth",
  gender: "gender",
  nationality: "nationality",
  guardianName: "guardian_name",
  guardianPhone: "guardian_phone",
  guardianEmail: "guardian_email",
  medicalFitness: "medical_fitness",
  class10Board: "class10_board",
  class10Year: "class10_year",
  class10Percent: "class10_percent",
  class12Board: "class12_board",
  class12Year: "class12_year",
  class12Percent: "class12_percent",
  class12Stream: "class12_stream",
};

const ADDRESS_PATH_TO_COLUMN: Record<string, StudentImportColumn> = {
  line1: "address_line1",
  line2: "address_line2",
  city: "city",
  state: "state",
  pincode: "pincode",
  country: "country",
};

/** Cells a spreadsheet would execute as a formula when the data is exported later. */
export function looksLikeFormula(value: string): boolean {
  return /^[=@\t\r]/.test(value) || /^[+-][^\d\s.]/.test(value);
}

const PHONE_PATTERN = /^\+?\d[\d\s-]{5,18}\d$/;

function parseBool(v: string): boolean | null {
  const s = v.trim().toLowerCase();
  if (["yes", "y", "true", "1", "fit"].includes(s)) return true;
  if (["no", "n", "false", "0", "unfit"].includes(s)) return false;
  return null;
}

/** YYYY-MM-DD or DD-MM-YYYY / DD/MM/YYYY -> midnight UTC ISO; rejects impossible dates. */
export function parseBirthDate(v: string): string | null {
  const s = v.trim();
  let y: number, m: number, d: number;
  let match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (match) [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  else if ((match = /^(\d{2})[-/](\d{2})[-/](\d{4})$/.exec(s))) [d, m, y] = [Number(match[1]), Number(match[2]), Number(match[3])];
  else return null;
  const t = new Date(Date.UTC(y, m - 1, d));
  if (t.getUTCFullYear() !== y || t.getUTCMonth() !== m - 1 || t.getUTCDate() !== d) return null;
  return t.toISOString();
}

const TEXT_COLUMNS: StudentImportColumn[] = [
  "first_name", "last_name", "email", "nationality", "address_line1", "address_line2", "city", "state",
  "pincode", "country", "guardian_name", "guardian_email", "class10_board", "class12_board", "campus_code",
];

export function normalizeStudentRow(
  raw: Partial<Record<StudentImportColumn, string>>,
  rowNumber: number,
  now: Date = new Date(),
): { row?: NormalizedStudentRow; issues: StudentImportIssue[] } {
  const issues: StudentImportIssue[] = [];
  const v = (k: StudentImportColumn) => {
    const s = raw[k]?.trim();
    return s ? s : undefined;
  };
  const issue = (column: StudentImportColumn, message: string) => issues.push({ rowNumber, column, message });

  for (const col of TEXT_COLUMNS) {
    const s = v(col);
    if (s && looksLikeFormula(s)) issue(col, `${col} must not start with =, +, -, @ or a control character`);
  }
  for (const col of ["phone", "guardian_phone"] as const) {
    const s = v(col);
    if (s && !PHONE_PATTERN.test(s)) issue(col, `${col} "${s}" is not a valid phone number`);
  }

  const candidate: Record<string, unknown> = {
    firstName: v("first_name"),
    lastName: v("last_name"),
    email: v("email")?.toLowerCase(),
    phone: v("phone")?.replace(/[\s-]/g, ""),
    nationality: v("nationality"),
    guardianName: v("guardian_name"),
    guardianPhone: v("guardian_phone")?.replace(/[\s-]/g, ""),
    guardianEmail: v("guardian_email")?.toLowerCase(),
    class10Board: v("class10_board"),
    class12Board: v("class12_board"),
  };
  for (const [col, field] of [["first_name", "firstName"], ["last_name", "lastName"], ["email", "email"], ["phone", "phone"]] as const) {
    if (!candidate[field]) issue(col, `${col} is required`);
  }

  const dob = v("date_of_birth");
  if (dob !== undefined) {
    const iso = parseBirthDate(dob);
    if (!iso) issue("date_of_birth", `"${dob}" is not a valid date (use YYYY-MM-DD)`);
    else if (new Date(iso) >= now) issue("date_of_birth", "date_of_birth must be in the past");
    else candidate.dateOfBirth = iso;
  }
  const gender = v("gender");
  if (gender !== undefined) {
    const g = gender.toUpperCase();
    candidate.gender = g === "M" ? "MALE" : g === "F" ? "FEMALE" : g;
  }
  const stream = v("class12_stream");
  if (stream !== undefined) candidate.class12Stream = stream.toUpperCase();
  const fit = v("medical_fitness");
  if (fit !== undefined) {
    const b = parseBool(fit);
    if (b === null) issue("medical_fitness", `"${fit}" is not yes/no`);
    else candidate.medicalFitness = b;
  }
  for (const [col, field] of [["class10_year", "class10Year"], ["class12_year", "class12Year"]] as const) {
    const s = v(col);
    if (s === undefined) continue;
    if (!/^\d{4}$/.test(s)) issue(col, `"${s}" is not a year`);
    else candidate[field] = Number(s);
  }
  for (const [col, field] of [["class10_percent", "class10Percent"], ["class12_percent", "class12Percent"]] as const) {
    const s = v(col)?.replace(/%$/, "");
    if (s === undefined) continue;
    if (!/^\d+(\.\d+)?$/.test(s)) issue(col, `"${s}" is not a number`);
    else candidate[field] = Number(s);
  }

  const address: Record<string, string> = {};
  for (const [field, col] of Object.entries(ADDRESS_PATH_TO_COLUMN)) {
    const s = v(col);
    if (s) address[field] = field === "country" ? s.toUpperCase() : s;
  }
  if (Object.keys(address).length > 0) candidate.address = address;

  const parsed = createStudentSchema.safeParse(candidate);
  if (!parsed.success) {
    for (const zi of parsed.error.issues) {
      const field = String(zi.path[0] ?? "");
      const column = field === "address" ? ADDRESS_PATH_TO_COLUMN[String(zi.path[1] ?? "")] ?? "address" : SCHEMA_PATH_TO_COLUMN[field] ?? field;
      if (issues.some((i) => i.column === column)) continue;
      issues.push({ rowNumber, column, message: `${column}: ${zi.message}` });
    }
  }
  if (issues.length > 0 || !parsed.success) return { issues };
  return { issues, row: { rowNumber, input: parsed.data, campusCode: v("campus_code") } };
}

export interface ParsedStudentCsv {
  fileErrors: string[];
  totalRows: number;
  rows: NormalizedStudentRow[];
  issues: StudentImportIssue[];
}

/** Parse + header validation + 150-row cap + per-row normalization + in-file duplicate emails. */
export function parseStudentCsv(text: string, now: Date = new Date()): ParsedStudentCsv {
  const result: ParsedStudentCsv = { fileErrors: [], totalRows: 0, rows: [], issues: [] };
  if (new TextEncoder().encode(text).length > MAX_STUDENT_IMPORT_BYTES) {
    result.fileErrors.push(`File is larger than ${Math.round(MAX_STUDENT_IMPORT_BYTES / 1000)} KB`);
    return result;
  }
  if (text.includes("\uFFFD")) {
    result.fileErrors.push('File is not valid UTF-8 — re-save it as "CSV UTF-8"');
    return result;
  }
  const parsed = parseCsv(text);
  if (parsed.unterminatedQuote) {
    result.fileErrors.push("Malformed CSV: a quoted cell is never closed");
    return result;
  }
  if (parsed.headers.length === 0 || parsed.headers.every((h) => !h)) {
    result.fileErrors.push("The file is empty — add a header row and at least one student");
    return result;
  }

  const headerMap = new Map<string, StudentImportColumn>();
  const seen = new Set<StudentImportColumn>();
  const unknown: string[] = [];
  for (const h of parsed.headers) {
    if (!h) continue;
    if (ORG_COLUMNS.has(h.trim().toLowerCase().replace(/[\s-]+/g, "_"))) {
      result.fileErrors.push(`Column "${h}" is not allowed: students are always imported into your own organization`);
      continue;
    }
    const key = canonicalStudentHeader(h);
    if (!key) {
      unknown.push(h);
      continue;
    }
    if (seen.has(key)) result.fileErrors.push(`Column "${key}" appears more than once`);
    seen.add(key);
    headerMap.set(h, key);
  }
  if (unknown.length > 0) result.fileErrors.push(`Unknown column(s): ${unknown.join(", ")}`);
  for (const c of STUDENT_IMPORT_COLUMNS) {
    if (c.required && !seen.has(c.key)) result.fileErrors.push(`Missing required column "${c.key}"`);
  }
  result.totalRows = parsed.rows.length;
  if (result.fileErrors.length > 0) return result;
  if (parsed.rows.length === 0) {
    result.fileErrors.push("The file has no student rows");
    return result;
  }
  if (parsed.rows.length > MAX_STUDENT_IMPORT_ROWS) {
    result.fileErrors.push(
      `The file has ${parsed.rows.length} student rows; the limit is ${MAX_STUDENT_IMPORT_ROWS} per upload — split the file`,
    );
    return result;
  }

  const headerWidth = parsed.headers.length;
  const firstByEmail = new Map<string, number>();
  parsed.rows.forEach((rawRow, idx) => {
    const rowNumber = parsed.rowNumbers[idx] ?? idx + 2;
    if ((parsed.cellCounts[idx] ?? 0) > headerWidth) {
      result.issues.push({ rowNumber, message: `Row has ${parsed.cellCounts[idx]} cells but the header has ${headerWidth} — check for an unquoted comma` });
      return;
    }
    const mapped: Partial<Record<StudentImportColumn, string>> = {};
    for (const [h, key] of headerMap) mapped[key] = rawRow[h];
    const { row, issues } = normalizeStudentRow(mapped, rowNumber, now);
    result.issues.push(...issues);
    if (!row) return;
    const dup = firstByEmail.get(row.input.email);
    if (dup !== undefined) {
      result.issues.push({ rowNumber, column: "email", message: `Duplicate of row ${dup} (same email ${row.input.email})` });
      return;
    }
    firstByEmail.set(row.input.email, rowNumber);
    result.rows.push(row);
  });
  return result;
}
