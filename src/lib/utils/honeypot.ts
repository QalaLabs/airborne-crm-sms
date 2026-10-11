/** Must match HONEYPOT_FIELD in the marketing site's src/utils/honeypot.js. */
export const HONEYPOT_FIELD = "hp_ref_code";

/** True when a public submission carried a non-empty honeypot value (a bot filled the hidden field). */
export function isHoneypotTripped(body: unknown): boolean {
  if (!body || typeof body !== "object") return false;
  const value = (body as Record<string, unknown>)[HONEYPOT_FIELD];
  if (value === undefined || value === null) return false;
  if (typeof value === "string") return value.trim().length > 0;
  return true;
}
