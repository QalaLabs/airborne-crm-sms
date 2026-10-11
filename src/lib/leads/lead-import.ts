import { LeadSource, LeadStatus } from "@prisma/client";
import { normalizePhone } from "@/lib/messaging/phone";
import { canonicalHeader } from "@/lib/leads/lead-import-headers";

export { MAX_IMPORT_ROWS, canonicalHeader } from "@/lib/leads/lead-import-headers";

/** Raw row as parsed from the uploaded sheet (header → cell text). */
export type RawImportRow = Record<string, string | undefined>;

export interface PreparedImportRow {
  rowNumber: number;
  name: string;
  phone: string;
  email: string | null;
  courseInterest: string | null;
  city: string | null;
  state: string | null;
  pincode: string | null;
  source: LeadSource;
  originalSource: string | null;
  status: LeadStatus;
  counselorEmail: string | null;
  createdAt: Date | null;
  notes: string | null;
}

export interface ImportRowError {
  rowNumber: number;
  reason: string;
}

/**
 * Canonical storage form for imported phones: 10-digit national number for
 * Indian mobiles (strips +91 / 91 / leading 0), digits-only otherwise.
 * Returns null when the value cannot be a phone number.
 */
export function canonicalImportPhone(raw: string): string | null {
  let digits = normalizePhone(raw);
  if (digits.startsWith("0")) digits = digits.replace(/^0+/, "");
  if (digits.length === 12 && digits.startsWith("91")) digits = digits.slice(2);
  if (digits.length < 7 || digits.length > 15) return null;
  return digits;
}

const SOURCE_VALUES = new Set<string>(Object.values(LeadSource));
const STATUS_VALUES = new Set<string>(Object.values(LeadStatus));

const SOURCE_ALIASES: Record<string, LeadSource> = {
  GOOGLE: "GOOGLE_ADS", ADWORDS: "GOOGLE_ADS",
  FACEBOOK: "FACEBOOK_ADS", META: "FACEBOOK_ADS", INSTAGRAM: "FACEBOOK_ADS", FB: "FACEBOOK_ADS",
  WEBSITE: "CONTACT_FORM", WEB: "CONTACT_FORM", FORM: "CONTACT_FORM",
  WALKIN: "WALK_IN", WALK: "WALK_IN", CALL: "DIRECT", PHONE: "DIRECT",
  WA: "WHATSAPP", SEO: "ORGANIC",
};

function toEnumKey(value: string): string {
  return value.trim().toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_|_$/g, "");
}

export function resolveImportSource(raw: string | undefined): LeadSource {
  if (!raw?.trim()) return "DIRECT";
  const key = toEnumKey(raw);
  if (SOURCE_VALUES.has(key)) return key as LeadSource;
  return SOURCE_ALIASES[key] ?? "DIRECT";
}

export function resolveImportStatus(raw: string | undefined): LeadStatus | null {
  if (!raw?.trim()) return "NEW";
  const key = toEnumKey(raw);
  return STATUS_VALUES.has(key) ? (key as LeadStatus) : null;
}

/** Accepts YYYY-MM-DD, DD-MM-YYYY, DD/MM/YYYY (Indian day-first), with optional time. */
export function parseImportDate(raw: string | undefined): Date | null | "invalid" {
  const value = raw?.trim();
  if (!value) return null;

  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(value);
  const dmy = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/.exec(value);
  let y: number, m: number, d: number;
  if (iso) {
    y = Number(iso[1]); m = Number(iso[2]); d = Number(iso[3]);
  } else if (dmy) {
    d = Number(dmy[1]); m = Number(dmy[2]); y = Number(dmy[3]);
  } else {
    return "invalid";
  }

  // Noon IST keeps the calendar day stable regardless of server timezone.
  const date = new Date(Date.UTC(y, m - 1, d, 6, 30));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return "invalid";
  if (date.getTime() > Date.now()) return "invalid";
  return date;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function clean(value: string | undefined, max: number): string | null {
  const v = value?.trim();
  return v ? v.slice(0, max) : null;
}

/**
 * Validates and normalizes raw sheet rows. Rows with a phone already seen
 * earlier in the same file are rejected so one upload never double-inserts.
 * `rowNumber` is the 1-based sheet row including the header (first data row = 2).
 */
export function prepareImportRows(rows: RawImportRow[]): { valid: PreparedImportRow[]; errors: ImportRowError[] } {
  const valid: PreparedImportRow[] = [];
  const errors: ImportRowError[] = [];
  const seenPhones = new Set<string>();

  rows.forEach((raw, index) => {
    const rowNumber = index + 2;
    const row: Record<string, string | undefined> = {};
    for (const [header, cell] of Object.entries(raw)) {
      const field = canonicalHeader(header);
      if (field && row[field] === undefined) row[field] = cell;
    }

    if (Object.values(row).every((v) => !v?.trim())) return;

    const name = clean(row.name, 255);
    if (!name || name.length < 2) {
      errors.push({ rowNumber, reason: "Name is missing" });
      return;
    }

    const phone = row.phone ? canonicalImportPhone(row.phone) : null;
    if (!phone) {
      errors.push({ rowNumber, reason: `Invalid phone "${row.phone ?? ""}"` });
      return;
    }
    if (seenPhones.has(phone)) {
      errors.push({ rowNumber, reason: `Phone ${phone} appears earlier in this file` });
      return;
    }

    const email = clean(row.email, 255);
    if (email && !EMAIL_RE.test(email)) {
      errors.push({ rowNumber, reason: `Invalid email "${email}"` });
      return;
    }

    const status = resolveImportStatus(row.status);
    if (!status) {
      errors.push({ rowNumber, reason: `Unknown status "${row.status}"` });
      return;
    }

    const createdAt = parseImportDate(row.createdAt);
    if (createdAt === "invalid") {
      errors.push({ rowNumber, reason: `Invalid date "${row.createdAt}" (use DD-MM-YYYY or YYYY-MM-DD)` });
      return;
    }

    const counselorEmail = clean(row.counselorEmail, 255)?.toLowerCase() ?? null;
    if (counselorEmail && !EMAIL_RE.test(counselorEmail)) {
      errors.push({ rowNumber, reason: `Counselor must be an email address, got "${counselorEmail}"` });
      return;
    }

    seenPhones.add(phone);
    valid.push({
      rowNumber,
      name,
      phone,
      email: email?.toLowerCase() ?? null,
      courseInterest: clean(row.courseInterest, 255),
      city: clean(row.city, 100),
      state: clean(row.state, 100),
      pincode: clean(row.pincode, 10),
      source: resolveImportSource(row.source),
      originalSource: clean(row.source, 100),
      status,
      counselorEmail,
      createdAt,
      notes: clean(row.notes, 5000),
    });
  });

  return { valid, errors };
}
