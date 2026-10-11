import { timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";

export type CronAuthFailure =
  | "missing_config"
  | "missing_credential"
  | "invalid_credential";

export type CronAuthResult =
  | { ok: true }
  | { ok: false; failure: CronAuthFailure };

function safeEqual(expected: string, provided: string): boolean {
  const a = Buffer.from(expected);
  const b = Buffer.from(provided);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function extractBearerToken(authorization: string | null): string | null {
  if (!authorization?.startsWith("Bearer ")) return null;
  const token = authorization.slice("Bearer ".length).trim();
  return token.length > 0 ? token : null;
}

/**
 * Validate Cloud Scheduler / cron caller using server-side CRON_SECRET only.
 * Uses constant-time comparison for the secret material.
 */
export function verifyCronSecret(
  req: Pick<NextRequest, "headers">,
  cronSecret = process.env.CRON_SECRET?.trim(),
): CronAuthResult {
  if (!cronSecret) {
    return { ok: false, failure: "missing_config" };
  }

  const bearer = extractBearerToken(req.headers.get("authorization"));
  const headerSecret = req.headers.get("x-cron-secret")?.trim() ?? null;
  const provided = bearer ?? headerSecret;

  if (!provided) {
    return { ok: false, failure: "missing_credential" };
  }

  if (!safeEqual(cronSecret, provided)) {
    return { ok: false, failure: "invalid_credential" };
  }

  return { ok: true };
}

export function cronAuthHttpStatus(failure: CronAuthFailure): number {
  if (failure === "missing_config") return 403;
  return 401;
}
