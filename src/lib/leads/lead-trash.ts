// Client-safe helpers for the lead Recycle Bin.

export const DEFAULT_LEAD_TRASH_RETENTION_DAYS = 30;

const DAY_MS = 24 * 60 * 60 * 1000;

/** Retention window; override with LEAD_TRASH_RETENTION_DAYS (1–365). */
export function leadTrashRetentionDays(raw: string | undefined = process.env.LEAD_TRASH_RETENTION_DAYS): number {
  const n = Number(raw);
  return Number.isInteger(n) && n >= 1 && n <= 365 ? n : DEFAULT_LEAD_TRASH_RETENTION_DAYS;
}

/** Leads deleted before this instant are due for permanent deletion. */
export function trashPurgeCutoff(retentionDays: number, now: Date = new Date()): Date {
  return new Date(now.getTime() - retentionDays * DAY_MS);
}

export function trashPurgeAt(deletedAt: Date | string, retentionDays: number): Date {
  return new Date(new Date(deletedAt).getTime() + retentionDays * DAY_MS);
}

/** Whole days left before auto-purge (0 means due today). */
export function trashDaysLeft(deletedAt: Date | string, retentionDays: number, now: Date = new Date()): number {
  const ms = trashPurgeAt(deletedAt, retentionDays).getTime() - now.getTime();
  return Math.max(0, Math.ceil(ms / DAY_MS));
}
