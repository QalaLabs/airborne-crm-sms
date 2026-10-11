/** Asia/Kolkata (IST, UTC+05:30, no DST) helpers for CRM follow-ups & display. */

export const IST_TIMEZONE = "Asia/Kolkata";
const IST_OFFSET_MIN = 330;

/** Format a UTC instant as IST for display (en-IN). */
export function formatInIST(
  date: string | Date | null | undefined,
  options: Intl.DateTimeFormatOptions = {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  },
): string {
  if (!date) return "-";
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return "-";
  return new Intl.DateTimeFormat("en-IN", { timeZone: IST_TIMEZONE, ...options }).format(d);
}

/** Convert a UTC ISO instant to an IST wall-clock "YYYY-MM-DDTHH:mm" for datetime-local. */
export function toISTInput(date: string | null | undefined): string {
  if (!date) return "";
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return "";
  return new Date(d.getTime() + IST_OFFSET_MIN * 60_000).toISOString().slice(0, 16);
}

/** UTC instant of 00:00 IST on the IST calendar day containing `d`. */
export function startOfISTDay(d: Date = new Date()): Date {
  const shifted = new Date(d.getTime() + IST_OFFSET_MIN * 60_000);
  const utcMidnight = Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate());
  return new Date(utcMidnight - IST_OFFSET_MIN * 60_000);
}

/** UTC instant of 23:59:59.999 IST on the IST calendar day containing `d`. */
export function endOfISTDay(d: Date = new Date()): Date {
  return new Date(startOfISTDay(d).getTime() + 86_400_000 - 1);
}

/** Parse an IST wall-clock datetime-local string back into a UTC ISO instant. */
export function fromISTInput(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(value);
  if (!match) return new Date(value).toISOString();
  const y = Number(match[1]);
  const mo = Number(match[2]);
  const da = Number(match[3]);
  const h = Number(match[4]);
  const mi = Number(match[5]);
  const utcMs = Date.UTC(y, mo - 1, da, h, mi) - IST_OFFSET_MIN * 60_000;
  return new Date(utcMs).toISOString();
}
