/**
 * Client IP resolution for rate limiting (F03 fix).
 *
 * Default trust posture is `TRUSTED_PROXY=none`: any `X-Forwarded-For` or
 * `X-Real-IP` a caller sends is attacker-controlled and must not be trusted
 * for enforcement-grade limits. On Cloud Run the managed HTTPS ingress (Google
 * Front End) APPENDS the immediate peer IP as the RIGHTMOST element of
 * `X-Forwarded-For`, so with `TRUSTED_PROXY=cloud-run` only the rightmost IP
 * literal is used. Anything a client sends therefore sits to the LEFT of the
 * proxy-appended value and is never trusted here.
 *
 * This is applied everywhere a per-client rate limit key is derived, including
 * the admin login guard — where `CF-Connecting-IP` (Cloudflare) must be added
 * to the trusted modes if that CDN ever fronts the admin app, otherwise every
 * visitor collapses into the same bucket.
 */

import type { NextRequest } from "next/server";

export type TrustedProxyMode = "cloud-run" | "none";

const IPV4_RE =
  /^(?:(?:25[0-5]|2[0-4][0-9]|1[0-9]{2}|[1-9]?[0-9])\.){3}(?:25[0-5]|2[0-4][0-9]|1[0-9]{2}|[1-9]?[0-9])$/;

/** Lenient IPv6 literal check (both raw and [bracketed]); ports are ignored. */
function isIpv6Literal(value: string): boolean {
  const unbracketed = value.startsWith("[") && value.endsWith("]") ? value.slice(1, -1) : value;
  if (!unbracketed) return false;
  if (/^[0-9a-fA-F:]+$/.test(unbracketed)) return true;
  // [v6]:port form
  const withoutPort = unbracketed.replace(/^\[(.*)\](?::\d+)?$/, "$1");
  return withoutPort !== unbracketed && /^[0-9a-fA-F:]+$/.test(withoutPort);
}

export function isIpLiteral(value: string): boolean {
  const v = value.trim();
  if (!v) return false;
  return IPV4_RE.test(v) || isIpv6Literal(v);
}

export function parseXForwardedFor(value: string | null | undefined): string[] {
  if (!value) return [];
  return value
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

export function resolveTrustedProxyMode(env: NodeJS.ProcessEnv = process.env): TrustedProxyMode {
  const raw = (env.TRUSTED_PROXY ?? "none").trim().toLowerCase();
  return raw === "cloud-run" || raw === "cloudrun" ? "cloud-run" : "none";
}

/**
 * Public lead intake is called server-to-server by the marketing site, so the
 * peer IP is the marketing server for every visitor. Only call this AFTER the
 * intake key has been verified: the key-holder is trusted to report the
 * visitor IP in `x-intake-client-ip`.
 */
export function resolveIntakeRateLimitIp(req: Pick<NextRequest, "headers">): string {
  const reported = (req.headers.get("x-intake-client-ip") ?? "").trim();
  if (isIpLiteral(reported)) return reported;
  return resolveClientIp(req);
}

export function resolveClientIp(req: Pick<NextRequest, "headers">): string {
  const mode = resolveTrustedProxyMode();
  const forwarded = parseXForwardedFor(req.headers.get("x-forwarded-for"));
  const realIp = (req.headers.get("x-real-ip") ?? "").trim();

  if (mode === "cloud-run") {
    // Rightmost value is the one the trusted GFE appended.
    for (let i = forwarded.length - 1; i >= 0; i--) {
      const candidate = forwarded[i];
      if (candidate && isIpLiteral(candidate)) return candidate;
    }
    if (isIpLiteral(realIp)) return realIp;
    return "unknown";
  }

  // "none" — no trusted proxy in front of the app. Client-supplied headers are
  // not trustworthy, so the first advertised value is used ONLY as a coarse
  // correlation token (development remains usable). Production must be
  // deployed behind the trusted Cloud Run proxy with TRUSTED_PROXY=cloud-run.
  const first = forwarded[0];
  if (first) return first;
  if (realIp) return realIp;
  return "unknown";
}