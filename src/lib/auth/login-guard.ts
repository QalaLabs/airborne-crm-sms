/**
 * NextAuth credentials-login rate limiting (F02 fix).
 *
 * Auth.js credentials `signIn` is a POST to `<root>/api/auth/callback/credentials`
 * with an `application/x-www-form-urlencoded` body containing `email`, and this
 * route is PUBLIC (NextAuth handles its own session auth). Wrapping every POST
 * to the NextAuth handler here enforces per-IP and per-account limits before
 * the Argon2 password hash is ever computed.
 *
 * The raw body must be read once and replayed into a fresh NextRequest so the
 * downstream handler still receives the exact bytes.
 */

import { NextRequest, NextResponse } from "next/server";
import { consumeRateLimit, rateLimitHeaders } from "@/lib/utils/rate-limit";
import { resolveClientIp } from "@/lib/utils/client-ip";
import { sha256 } from "@/lib/utils/crypto";

export const LOGIN_IP_LIMIT = 20;
export const LOGIN_ACCOUNT_LIMIT = 5;
export const LOGIN_WINDOW_MS = 5 * 60_000;

function loginBlocked(message: string, decision: { resetAt: number }): NextResponse {
  return NextResponse.json(
    { error: message },
    { status: 429, headers: rateLimitHeaders({ allowed: false, remaining: 0, limit: 0, resetAt: decision.resetAt }) },
  );
}

export type LoginGuardResult =
  | { request: NextRequest; response: null }
  | { request: null; response: NextResponse };

export async function guardCredentialsLogin(req: NextRequest): Promise<LoginGuardResult> {
  if (!req.nextUrl.pathname.endsWith("/callback/credentials")) {
    return { request: req, response: null };
  }

  // The body is captured exactly once and replayed to the NextAuth handler.
  const bodyText = await req.text();
  let email = "";
  try {
    email = new URLSearchParams(bodyText).get("email")?.trim().toLowerCase() ?? "";
  } catch {
    email = "";
  }

  const ip = resolveClientIp(req);
  const ipDecision = await consumeRateLimit(`auth:login:ip:${ip}`, LOGIN_IP_LIMIT, LOGIN_WINDOW_MS);
  if (!ipDecision.allowed) {
    return { request: null, response: loginBlocked("Too many sign-in attempts. Please try again later.", ipDecision) };
  }

  if (email) {
    const acctDecision = await consumeRateLimit(
      `auth:login:acct:${sha256(email)}`,
      LOGIN_ACCOUNT_LIMIT,
      LOGIN_WINDOW_MS,
    );
    if (!acctDecision.allowed) {
      return {
        request: null,
        response: loginBlocked("Too many sign-in attempts for this account. Please try again later.", acctDecision),
      };
    }
  }

  return {
    request: new NextRequest(req.url, {
      method: req.method,
      headers: req.headers,
      body: bodyText,
    }),
    response: null,
  };
}