import { ValidationError } from "@/lib/utils/errors";
import { IST_TIMEZONE } from "@/lib/time/ist";

/**
 * Analytics report window.
 *
 * `from` / `to` are IST (Asia/Kolkata, UTC+05:30) wall-clock values, either
 * `YYYY-MM-DD` or `YYYY-MM-DDTHH:mm`. Both bounds are inclusive:
 *   - date-only `from` starts at 00:00:00.000 IST, date-only `to` ends at 23:59:59.999 IST;
 *   - a `to` with a time includes that whole minute (HH:mm:59.999).
 * Records are matched on their creation timestamp (`createdAt`).
 */
export interface AnalyticsRange {
  from: Date;
  to: Date;
  fromInput: string;
  toInput: string;
}

const IST_OFFSET_MS = 330 * 60_000;
export const MAX_ANALYTICS_RANGE_DAYS = 5 * 366;
const MIN_YEAR = 2000;
const INPUT_RE = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?$/;

export function parseISTWallClock(value: string, edge: "start" | "end"): Date | null {
  const m = INPUT_RE.exec(value.trim());
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const hasTime = m[4] !== undefined;
  const h = hasTime ? Number(m[4]) : edge === "start" ? 0 : 23;
  const mi = hasTime ? Number(m[5]) : edge === "start" ? 0 : 59;
  if (y < MIN_YEAR || mo < 1 || mo > 12 || h > 23 || mi > 59) return null;
  const wall = Date.UTC(y, mo - 1, d, h, mi);
  const check = new Date(wall);
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== d) return null;
  const extra = edge === "end" ? 59_999 : 0;
  return new Date(wall - IST_OFFSET_MS + extra);
}

function fail(field: "from" | "to" | "range", message: string): never {
  throw new ValidationError([{ path: [field], message }]);
}

/** Returns null when no range is requested (report covers all time). */
export function parseAnalyticsRange(params: URLSearchParams, now: Date = new Date()): AnalyticsRange | null {
  const fromInput = params.get("from")?.trim() ?? "";
  const toInput = params.get("to")?.trim() ?? "";
  if (!fromInput && !toInput) return null;
  if (!fromInput) fail("from", "Start date is required when an end date is given");
  if (!toInput) fail("to", "End date is required when a start date is given");

  const from = parseISTWallClock(fromInput, "start");
  if (!from) fail("from", "Use YYYY-MM-DD or YYYY-MM-DDTHH:mm (IST)");
  const to = parseISTWallClock(toInput, "end");
  if (!to) fail("to", "Use YYYY-MM-DD or YYYY-MM-DDTHH:mm (IST)");

  if (from.getTime() > to.getTime()) fail("range", "Start must be on or before the end");
  if (from.getTime() > now.getTime()) fail("from", "Start cannot be in the future");
  if (to.getTime() - from.getTime() > MAX_ANALYTICS_RANGE_DAYS * 86_400_000) {
    fail("range", `Range cannot exceed ${MAX_ANALYTICS_RANGE_DAYS} days`);
  }
  return { from, to, fromInput, toInput };
}

/** IST calendar month key `YYYY-MM` for an instant. */
export function istMonthKey(d: Date): string {
  const shifted = new Date(d.getTime() + IST_OFFSET_MS);
  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** UTC instant of 00:00 IST on the 1st of the IST month containing `d`, shifted by `deltaMonths`. */
export function startOfISTMonth(d: Date, deltaMonths = 0): Date {
  const shifted = new Date(d.getTime() + IST_OFFSET_MS);
  return new Date(Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth() + deltaMonths, 1) - IST_OFFSET_MS);
}

/** Inclusive list of IST month keys between two instants. */
export function istMonthKeysBetween(from: Date, to: Date): string[] {
  const keys: string[] = [];
  const end = istMonthKey(to);
  for (let i = 0; i < 12 * 6; i++) {
    const key = istMonthKey(startOfISTMonth(from, i));
    keys.push(key);
    if (key === end) break;
  }
  return keys;
}

export const ANALYTICS_TIMEZONE = IST_TIMEZONE;
