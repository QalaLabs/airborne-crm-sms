// Batch schedule = optional frequency + same-day time window (HH:MM, academy
// wall clock) stored in LmsBatch.metadata.schedule, plus the batch's own
// startDate/endDate columns. Overnight windows (end time past midnight) are
// not supported: the end time must be later than the start time on the same day.

export const BATCH_FREQUENCIES = [
  "DAILY",
  "WEEKLY",
  "CONSECUTIVE",
  "ALTERNATE",
  "BI_WEEKLY",
  "MONTHLY",
  "BI_MONTHLY",
] as const;
export type BatchFrequency = (typeof BATCH_FREQUENCIES)[number];

export const FREQUENCY_LABELS: Record<BatchFrequency, string> = {
  DAILY: "Daily",
  WEEKLY: "Weekly",
  CONSECUTIVE: "Consecutive days",
  ALTERNATE: "Alternate days",
  BI_WEEKLY: "Bi-weekly",
  MONTHLY: "Monthly",
  BI_MONTHLY: "Bi-monthly",
};

export const ACADEMY_TIME_ZONE = "Asia/Kolkata";

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATE_INPUT_RE = /^\d{4}-\d{2}-\d{2}$/;

export interface BatchSchedule {
  frequency: BatchFrequency | null;
  startTime: string | null;
  endTime: string | null;
}

export function isBatchFrequency(v: unknown): v is BatchFrequency {
  return typeof v === "string" && (BATCH_FREQUENCIES as readonly string[]).includes(v);
}

export function isTimeOfDay(v: unknown): v is string {
  return typeof v === "string" && TIME_RE.test(v);
}

/** Reads metadata.schedule defensively; anything malformed becomes null. */
export function parseSchedule(metadata: unknown): BatchSchedule {
  const empty: BatchSchedule = { frequency: null, startTime: null, endTime: null };
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return empty;
  const raw = (metadata as Record<string, unknown>).schedule;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return empty;
  const s = raw as Record<string, unknown>;
  return {
    frequency: isBatchFrequency(s.frequency) ? s.frequency : null,
    startTime: isTimeOfDay(s.startTime) ? s.startTime : null,
    endTime: isTimeOfDay(s.endTime) ? s.endTime : null,
  };
}

/** "09:00" → "9:00 AM", "13:05" → "1:05 PM", "00:30" → "12:30 AM". */
export function formatTime12h(hhmm: string | null | undefined): string | null {
  if (!isTimeOfDay(hhmm)) return null;
  const [h, m] = hhmm.split(":").map(Number) as [number, number];
  const suffix = h >= 12 ? "PM" : "AM";
  return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${suffix}`;
}

/** Calendar date of a stored batch date, as seen at the academy (IST). */
export function formatBatchDate(value: string | Date | null | undefined): string | null {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: ACADEMY_TIME_ZONE });
}

/** "2026-11-01" (date input) → "2026-11-01T00:00:00.000Z"; empty/invalid → null. */
export function dateInputToIso(value: string | null | undefined): string | null {
  if (!value || !DATE_INPUT_RE.test(value)) return null;
  const d = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== value ? null : d.toISOString();
}

/** e.g. "Daily · 9:00 AM – 11:30 AM · 1 Nov 2026 → 31 Jan 2027". Null when nothing to show. */
export function scheduleSummary(batch: {
  startDate?: string | Date | null;
  endDate?: string | Date | null;
  metadata?: unknown;
}): string | null {
  const s = parseSchedule(batch.metadata);
  const parts: string[] = [];
  if (s.frequency) parts.push(FREQUENCY_LABELS[s.frequency]);
  const start = formatTime12h(s.startTime);
  const end = formatTime12h(s.endTime);
  if (start && end) parts.push(`${start} – ${end}`);
  else if (start) parts.push(`from ${start}`);
  else if (end) parts.push(`until ${end}`);
  const from = formatBatchDate(batch.startDate);
  const to = formatBatchDate(batch.endDate);
  if (from && to) parts.push(`${from} → ${to}`);
  else if (from) parts.push(`from ${from}`);
  else if (to) parts.push(`until ${to}`);
  return parts.length ? parts.join(" · ") : null;
}

/**
 * Shared rule set for the create form and the API schema.
 * Times are an all-or-nothing pair; an end date needs a start date; end must follow start.
 */
export function scheduleError(input: {
  startTime?: string | null;
  endTime?: string | null;
  startDate?: string | null;
  endDate?: string | null;
}): string | null {
  const { startTime, endTime, startDate, endDate } = input;
  if (startTime && !isTimeOfDay(startTime)) return "Start time must be HH:MM.";
  if (endTime && !isTimeOfDay(endTime)) return "End time must be HH:MM.";
  if (Boolean(startTime) !== Boolean(endTime)) return "Set both a start time and an end time.";
  if (startTime && endTime && endTime <= startTime) {
    return "End time must be after start time (overnight batches are not supported).";
  }
  if (endDate && !startDate) return "Set a start date before an end date.";
  if (startDate && endDate) {
    const a = new Date(startDate).getTime();
    const b = new Date(endDate).getTime();
    if (Number.isNaN(a) || Number.isNaN(b)) return "Dates are invalid.";
    if (b < a) return "End date must be on or after start date.";
  }
  return null;
}
